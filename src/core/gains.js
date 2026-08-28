/**
 * gains.js
 * The single capital gains engine. Every surface — desktop renderer, React
 * Native screens, CLI verifiers, tests — calls this and only this, so the
 * numbers cannot drift between them.
 */

import { getAsset } from './assets.js';
import { normaliseHistory } from './transactions.js';
import { createLot, drawFromLot, orderLotsForDisposal, isCostBasisMethod, COST_BASIS_METHODS } from './lots.js';
import { applyWashSales } from './washsale.js';
import { classifyTerm, daysHeld, TERM } from './holdingPeriod.js';
import { valueOf, allocate } from './money.js';
import { minBigInt } from './decimal.js';

const DEFAULTS = Object.freeze({
    method: 'FIFO',
    applyWashSale: true,
    respectFrozen: true,
});

/** Records one lot-level disposal line. Form 8949 wants one row per lot. */
const makeDisposal = ({ tx, lot, units, basisCents, proceedsCents, sequence }) => ({
    id: `${tx.id}:${lot ? lot.id : 'unmatched'}:${sequence}`,
    txId: tx.id,
    lotId: lot ? lot.id : null,
    asset: tx.asset,
    decimals: tx.decimals,
    acquiredDate: lot ? lot.acquiredDate : null,
    holdingStartAt: lot ? lot.holdingStartAt : tx.timestamp,
    soldDate: tx.date,
    soldAt: tx.timestamp,
    units,
    proceedsCents,
    basisCents,
    rawGainCents: proceedsCents - basisCents,
    disallowedLossCents: 0n,
    cascadedAdjustmentCents: 0n,
    washSale: false,
    replacementLotIds: [],
    fromFrozenLot: Boolean(lot && lot.frozen),
    isCoinJoin: tx.isCoinJoin,
    isLightning: tx.isLightning,
    sequence,
});

/**
 * Consumes inventory for one SELL, emitting a disposal per lot touched.
 * Proceeds are split across lots by quantity, with the final draw absorbing
 * the rounding remainder so the parts sum to the net proceeds exactly.
 */
const disposeSell = (tx, lots, disposals, warnings, options) => {
    const grossCents = valueOf(tx.units, tx.decimals, tx.price);
    const netProceedsCents = grossCents - tx.feeCents;
    const order = orderLotsForDisposal(lots, options.method, options.respectFrozen);

    let unitsRemaining = tx.units;
    let proceedsRemaining = netProceedsCents;

    for (const lot of order) {
        if (unitsRemaining <= 0n) break;

        const take = minBigInt(lot.units, unitsRemaining);
        const basisCents = drawFromLot(lot, take);
        const isFinalDraw = take === unitsRemaining;
        const proceedsCents = isFinalDraw ? proceedsRemaining : allocate(netProceedsCents, take, tx.units);

        if (lot.frozen) {
            warnings.push({
                code: 'FROZEN_LOT_SPENT',
                txId: tx.id,
                lotId: lot.id,
                message: `Sale ${tx.id} on ${tx.date} had to draw on frozen lot ${lot.id}; unfrozen inventory was exhausted.`,
            });
        }

        disposals.push(makeDisposal({ tx, lot, units: take, basisCents, proceedsCents, sequence: disposals.length }));
        unitsRemaining -= take;
        proceedsRemaining -= proceedsCents;
    }

    if (unitsRemaining > 0n) recordUncoveredDisposal(tx, unitsRemaining, proceedsRemaining, disposals, warnings);
};

/**
 * Handles a sale larger than the recorded inventory. The uncovered quantity is
 * reported at zero basis — the IRS default when basis cannot be substantiated —
 * rather than being silently dropped, which is what understated the old engine.
 */
const recordUncoveredDisposal = (tx, unitsRemaining, proceedsRemaining, disposals, warnings) => {
    warnings.push({
        code: 'INSUFFICIENT_INVENTORY',
        txId: tx.id,
        message: `Sale ${tx.id} on ${tx.date} exceeds recorded holdings. `
            + `The uncovered quantity is reported at zero cost basis; supply the missing acquisition to correct it.`,
    });
    disposals.push(makeDisposal({
        tx,
        lot: null,
        units: unitsRemaining,
        basisCents: 0n,
        proceedsCents: proceedsRemaining,
        sequence: disposals.length,
    }));
};

/**
 * Resolves each disposal's final gain and term once wash sale adjustments,
 * including holding period tacking, have settled.
 */
const finaliseDisposals = (disposals, lotsById) => {
    for (const disposal of disposals) {
        const lot = lotsById.get(disposal.lotId);
        if (lot) disposal.holdingStartAt = lot.holdingStartAt;

        disposal.gainCents = disposal.proceedsCents - disposal.basisCents + disposal.disallowedLossCents;
        disposal.term = classifyTerm(disposal.holdingStartAt, disposal.soldAt);
        disposal.daysHeld = daysHeld(disposal.holdingStartAt, disposal.soldAt);
    }
};

/** Aggregates the report into the figures a Schedule D summary needs. */
const summarise = (disposals, openLots, decimals) => {
    const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0n);
    const shortTerm = disposals.filter((d) => d.term === TERM.SHORT);
    const longTerm = disposals.filter((d) => d.term === TERM.LONG);

    return {
        decimals,
        disposalCount: disposals.length,
        proceedsCents: sum(disposals, (d) => d.proceedsCents),
        basisCents: sum(disposals, (d) => d.basisCents),
        netGainCents: sum(disposals, (d) => d.gainCents),
        shortTermGainCents: sum(shortTerm, (d) => d.gainCents),
        longTermGainCents: sum(longTerm, (d) => d.gainCents),
        shortTermCount: shortTerm.length,
        longTermCount: longTerm.length,
        disallowedLossCents: sum(disposals, (d) => d.disallowedLossCents),
        washSaleCount: disposals.filter((d) => d.washSale).length,
        openUnits: sum(openLots, (lot) => lot.units),
        openBasisCents: sum(openLots, (lot) => lot.basisCents),
    };
};

/**
 * Runs a full audit over a trade history.
 *
 * @param {Array<object>} history - raw transactions
 * @param {object} [options]
 * @param {string} [options.asset='BTC'] - default asset for rows that omit one
 * @param {'FIFO'|'LIFO'|'HIFO'} [options.method='FIFO']
 * @param {boolean} [options.applyWashSale=true] - conservative section 1091 treatment
 * @param {boolean} [options.respectFrozen=true] - hold frozen lots back from selection
 * @param {Object<string,{frozen?:boolean,label?:string}>} [options.lotState] - coin control state by lot id
 * @returns {{disposals:Array, openLots:Array, lots:Array, summary:object, warnings:Array, options:object}}
 */
export const calculateGains = (history, options = {}) => {
    const asset = getAsset(options.asset || 'BTC');
    const method = String(options.method || DEFAULTS.method).toUpperCase();
    if (!isCostBasisMethod(method)) {
        throw new RangeError(`Unknown cost basis method "${options.method}". Supported: ${COST_BASIS_METHODS.join(', ')}`);
    }

    const settings = {
        asset: asset.symbol,
        method,
        applyWashSale: options.applyWashSale ?? DEFAULTS.applyWashSale,
        respectFrozen: options.respectFrozen ?? DEFAULTS.respectFrozen,
    };
    const lotState = options.lotState || {};

    const transactions = normaliseHistory(history, asset.symbol);
    const lots = [];
    const disposals = [];
    const warnings = [];

    for (const tx of transactions) {
        if (tx.type === 'BUY') {
            const lot = createLot(tx, valueOf(tx.units, tx.decimals, tx.price));
            const state = lotState[lot.id];
            if (state) {
                lot.frozen = Boolean(state.frozen);
                lot.label = typeof state.label === 'string' ? state.label : '';
            }
            lots.push(lot);
        } else {
            disposeSell(tx, lots, disposals, warnings, settings);
        }
    }

    if (settings.applyWashSale) applyWashSales(disposals, lots);

    const lotsById = new Map(lots.map((lot) => [lot.id, lot]));
    finaliseDisposals(disposals, lotsById);

    const openLots = lots.filter((lot) => lot.units > 0n);
    return {
        transactions,
        disposals,
        lots,
        openLots,
        summary: summarise(disposals, openLots, asset.decimals),
        warnings,
        options: settings,
    };
};
