/**
 * gains.js
 * The single capital gains engine. Every surface — the desktop renderer, the
 * CLI verifiers, the tests — calls this and only this, so the numbers cannot
 * drift between them.
 *
 * One chronological pass per asset:
 *   BUY  -> the lot (and any tranche already carved out of it) joins the pool
 *   SELL -> lots are drawn in method order, one disposal line per lot touched;
 *           each line realised at a loss is immediately tested for a wash sale
 *
 * Because wash adjustments land at the moment the loss is realised, every
 * later sale sees the adjusted basis and tacked holding period. HIFO ranks by
 * adjusted basis, and a loss on a replacement lot is itself tested. No second
 * pass revises figures that were already reported.
 */

import { getAsset } from './assets.js';
import { normaliseHistory } from './transactions.js';
import { createLot, drawFromLot, splitLot, LotPool, isCostBasisMethod, COST_BASIS_METHODS } from './lots.js';
import { ReplacementIndex, washDisposal } from './washsale.js';
import { classifyTerm, daysHeld, taxYearOf, TERM } from './holdingPeriod.js';
import { allocate } from './money.js';
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
    originId: lot ? lot.originId : null,
    asset: tx.asset,
    decimals: tx.decimals,
    acquiredDate: lot ? lot.acquiredDate : null,
    holdingStartAt: lot ? lot.holdingStartAt : tx.timestamp,
    soldDate: tx.date,
    soldAt: tx.timestamp,
    soldDay: tx.day,
    taxYear: taxYearOf(tx.timestamp),
    units,
    proceedsCents,
    basisCents,
    rawGainCents: proceedsCents - basisCents,
    disallowedLossCents: 0n,
    gainCents: proceedsCents - basisCents,
    washSale: false,
    replacementLotIds: [],
    fromFrozenLot: Boolean(lot && lot.frozen),
    isCoinJoin: tx.isCoinJoin,
    isLightning: tx.isLightning,
    sequence,
});

/** Sets the fields that depend on the final holding start and disallowance. */
const finaliseDisposal = (disposal) => {
    disposal.gainCents = disposal.proceedsCents - disposal.basisCents + disposal.disallowedLossCents;
    disposal.term = classifyTerm(disposal.holdingStartAt, disposal.soldAt);
    disposal.daysHeld = daysHeld(disposal.holdingStartAt, disposal.soldAt);
    return disposal;
};

const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0n);

/**
 * Aggregates disposals into the figures a Schedule D summary needs.
 * Exported so a caller can summarise a filtered subset, e.g. one tax year.
 *
 * @param {Array<object>} disposals
 */
export const summariseDisposals = (disposals) => {
    const shortTerm = disposals.filter((d) => d.term === TERM.SHORT);
    const longTerm = disposals.filter((d) => d.term === TERM.LONG);

    return {
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
    };
};

/** Disposals grouped by the calendar year of sale — the unit a return is filed in. */
export const summariseByTaxYear = (disposals) => {
    const years = new Map();
    for (const disposal of disposals) {
        const list = years.get(disposal.taxYear);
        if (list) list.push(disposal);
        else years.set(disposal.taxYear, [disposal]);
    }
    return Object.fromEntries([...years.keys()].sort((a, b) => a - b).map((year) => [year, summariseDisposals(years.get(year))]));
};

const resolveSettings = (options) => {
    const asset = getAsset(options.asset || 'BTC');
    const method = String(options.method || DEFAULTS.method).toUpperCase();
    if (!isCostBasisMethod(method)) {
        throw new RangeError(`Unknown cost basis method "${options.method}". Supported: ${COST_BASIS_METHODS.join(', ')}`);
    }
    return {
        asset: asset.symbol,
        decimals: asset.decimals,
        method,
        applyWashSale: options.applyWashSale ?? DEFAULTS.applyWashSale,
        respectFrozen: options.respectFrozen ?? DEFAULTS.respectFrozen,
    };
};

/**
 * Runs a full audit over one asset's trade history.
 *
 * Lots from different assets never share a pool: a Bitcoin sale cannot draw on
 * an Ethereum lot, and an Ethereum purchase is not "substantially identical"
 * to Bitcoin for wash sale purposes. A history that mixes assets is refused;
 * use `calculatePortfolio` to audit several.
 *
 * @param {Array<object>} history - raw transactions
 * @param {object} [options]
 * @param {string} [options.asset='BTC'] - the asset audited; rows may omit it
 * @param {'FIFO'|'LIFO'|'HIFO'} [options.method='FIFO']
 * @param {boolean} [options.applyWashSale=true] - conservative section 1091 treatment
 * @param {boolean} [options.respectFrozen=true] - hold frozen lots back from selection
 * @param {Object<string,{frozen?:boolean,label?:string}>} [options.lotState] - coin control state by origin lot id
 */
export const calculateGains = (history, options = {}) => {
    const settings = resolveSettings(options);
    const lotState = options.lotState || {};

    const transactions = normaliseHistory(history, settings.asset);
    const foreign = transactions.find((tx) => tx.asset !== settings.asset);
    if (foreign) {
        throw new RangeError(
            `Transaction ${foreign.id} is ${foreign.asset}, but this audit is for ${settings.asset}. `
            + 'Audit each asset separately, or use calculatePortfolio.',
        );
    }

    // Every lot exists up front so that a purchase made after a loss sale can
    // be found as its replacement; it only enters the pool when acquired.
    const lotsByTx = new Map();
    const lots = [];
    for (const tx of transactions) {
        if (tx.type !== 'BUY') continue;
        const lot = createLot(tx);
        const state = lotState[lot.originId];
        if (state) {
            lot.frozen = Boolean(state.frozen);
            lot.label = typeof state.label === 'string' ? state.label : '';
        }
        lotsByTx.set(tx.id, lot);
        lots.push(lot);
    }

    const pool = new LotPool(settings.method, settings.respectFrozen);
    const index = new ReplacementIndex(lots);
    const acquired = new Set();
    const pendingTranches = new Map();
    const trancheCounts = new Map();
    const disposals = [];
    const warnings = [];

    const hooks = {
        split: (lot, units) => {
            const count = (trancheCounts.get(lot.originId) || 0) + 1;
            trancheCounts.set(lot.originId, count);
            const tranche = splitLot(lot, units, count);
            lots.push(tranche);
            if (acquired.has(lot.originId)) {
                pool.refresh(lot);
                pool.add(tranche);
            } else {
                const list = pendingTranches.get(lot.originId) || [];
                list.push(tranche);
                pendingTranches.set(lot.originId, list);
            }
            return tranche;
        },
        adjusted: (lot) => pool.refresh(lot),
    };

    const disposeSell = (tx) => {
        const netProceedsCents = tx.grossCents - tx.feeCents;
        let unitsRemaining = tx.units;
        let proceedsRemaining = netProceedsCents;
        const lines = [];

        while (unitsRemaining > 0n) {
            const lot = pool.next();
            if (!lot) break;

            const take = minBigInt(lot.units, unitsRemaining);
            const holdingStartAt = lot.holdingStartAt;
            const basisCents = drawFromLot(lot, take);
            const isFinalDraw = take === unitsRemaining;
            const proceedsCents = isFinalDraw ? proceedsRemaining : allocate(netProceedsCents, take, tx.units);
            if (lot.units > 0n) pool.add(lot);

            if (lot.frozen && settings.respectFrozen) {
                warnings.push({
                    code: 'FROZEN_LOT_SPENT',
                    txId: tx.id,
                    lotId: lot.id,
                    message: `Sale ${tx.id} on ${tx.date} had to draw on frozen lot ${lot.originId}; unfrozen inventory was exhausted.`,
                });
            }

            const disposal = makeDisposal({ tx, lot, units: take, basisCents, proceedsCents, sequence: disposals.length });
            disposal.holdingStartAt = holdingStartAt;
            disposals.push(disposal);
            lines.push({ disposal, lot });
            unitsRemaining -= take;
            proceedsRemaining -= proceedsCents;
        }

        if (unitsRemaining > 0n) {
            // The IRS default when basis cannot be substantiated is zero. The
            // uncovered quantity is reported, never silently dropped.
            warnings.push({
                code: 'INSUFFICIENT_INVENTORY',
                txId: tx.id,
                message: `Sale ${tx.id} on ${tx.date} exceeds recorded holdings. `
                    + 'The uncovered quantity is reported at zero cost basis; supply the missing acquisition to correct it.',
            });
            disposals.push(makeDisposal({
                tx, lot: null, units: unitsRemaining, basisCents: 0n, proceedsCents: proceedsRemaining, sequence: disposals.length,
            }));
        }

        // Wash testing happens after the whole sale is drawn, so units this
        // sale consumed are no longer counted as held replacements.
        if (settings.applyWashSale) {
            for (const { disposal, lot } of lines) {
                if (disposal.rawGainCents < 0n) washDisposal(disposal, lot, index, hooks);
            }
        }
    };

    for (const tx of transactions) {
        if (tx.type === 'BUY') {
            const lot = lotsByTx.get(tx.id);
            acquired.add(lot.originId);
            pool.add(lot);
            for (const tranche of pendingTranches.get(lot.originId) || []) pool.add(tranche);
            pendingTranches.delete(lot.originId);
        } else {
            disposeSell(tx);
        }
    }

    disposals.forEach(finaliseDisposal);

    const openLots = lots
        .filter((lot) => lot.units > 0n)
        .sort((a, b) => a.acquiredAt - b.acquiredAt || a.txSequence - b.txSequence || a.tranche - b.tranche);

    return {
        transactions,
        disposals,
        lots,
        openLots,
        summary: {
            decimals: settings.decimals,
            ...summariseDisposals(disposals),
            openUnits: sum(openLots, (lot) => lot.units),
            openBasisCents: sum(openLots, (lot) => lot.basisCents),
        },
        byTaxYear: summariseByTaxYear(disposals),
        warnings,
        options: {
            asset: settings.asset,
            method: settings.method,
            applyWashSale: settings.applyWashSale,
            respectFrozen: settings.respectFrozen,
        },
    };
};

/**
 * Audits a history that may hold several assets, one independent pool each.
 *
 * @param {Array<object>} history
 * @param {object} [options] - as calculateGains, minus `asset`
 * @returns {Object<string, ReturnType<typeof calculateGains>>} results keyed by asset
 */
export const calculatePortfolio = (history, options = {}) => {
    if (!Array.isArray(history)) throw new TypeError('History must be an array');
    const byAsset = new Map();
    for (const tx of history) {
        const symbol = getAsset((tx && tx.asset) || options.asset || 'BTC').symbol;
        const list = byAsset.get(symbol);
        if (list) list.push(tx);
        else byAsset.set(symbol, [tx]);
    }
    return Object.fromEntries([...byAsset].map(([asset, list]) => [asset, calculateGains(list, { ...options, asset })]));
};
