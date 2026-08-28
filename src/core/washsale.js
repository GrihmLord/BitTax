/**
 * washsale.js
 * IRS-style wash sale treatment (26 U.S.C. 1091 / Pub 550).
 *
 * A loss is disallowed to the extent substantially identical property was
 * acquired within 30 days before or after the sale — a 61 day window. The
 * disallowed loss is not deleted: it is added to the cost basis of the
 * replacement lot, and the replacement inherits the holding period of the
 * position that was washed.
 *
 * NOTE ON APPLICABILITY: section 1091 is written for "stocks or securities".
 * Digital assets are generally treated as property rather than securities, so
 * this treatment is conservative and optional. It is applied only when the
 * caller asks for it, and every adjustment is reported line by line so the
 * effect can be shown to a preparer.
 */

import { allocate } from './money.js';
import { minBigInt } from './decimal.js';

export const WASH_SALE_WINDOW_DAYS = 30;
const DAY_MS = 86400000;

/**
 * Indexes disposals by the lot they were drawn from, so a basis adjustment
 * landing on an already-liquidated lot can be pushed onto the sales that
 * consumed it instead of vanishing.
 */
const indexDisposalsByLot = (disposals) => {
    const index = new Map();
    for (const disposal of disposals) {
        const list = index.get(disposal.lotId);
        if (list) list.push(disposal);
        else index.set(disposal.lotId, [disposal]);
    }
    return index;
};

/**
 * Applies a basis increase to a replacement lot, splitting it between the
 * units still open and the units that have already been sold on.
 */
const creditReplacementBasis = (lot, adjustmentCents, disposalsByLot) => {
    lot.washAdjustmentCents += adjustmentCents;

    const openShare = lot.originalUnits === 0n
        ? adjustmentCents
        : allocate(adjustmentCents, lot.units, lot.originalUnits);
    lot.basisCents += openShare;

    let cascade = adjustmentCents - openShare;
    if (cascade === 0n) return;

    const priorSales = disposalsByLot.get(lot.id) || [];
    const soldUnits = priorSales.reduce((sum, sale) => sum + sale.units, 0n);
    if (soldUnits === 0n) {
        lot.basisCents += cascade;
        return;
    }

    priorSales.forEach((sale, index) => {
        const share = index === priorSales.length - 1 ? cascade : allocate(adjustmentCents - openShare, sale.units, soldUnits);
        sale.basisCents += share;
        sale.cascadedAdjustmentCents = (sale.cascadedAdjustmentCents || 0n) + share;
        cascade -= share;
    });
};

/**
 * Finds acquisitions eligible to absorb a loss: inside the 61 day window,
 * not the lot being sold, and not already spoken for by an earlier wash.
 */
const eligibleReplacements = (lots, disposal, remainingUnits, windowMs) =>
    lots.filter((lot) =>
        lot.id !== disposal.lotId
        && lot.acquiredAt !== undefined
        && Math.abs(lot.acquiredAt - disposal.soldAt) <= windowMs
        && (remainingUnits.get(lot.id) || 0n) > 0n);

/**
 * Matches one loss disposal against replacement lots and records the
 * disallowance on both sides.
 */
const washOneDisposal = (disposal, lots, remainingUnits, disposalsByLot, windowMs) => {
    const totalLoss = -disposal.rawGainCents;
    let unitsToMatch = disposal.units;

    for (const lot of eligibleReplacements(lots, disposal, remainingUnits, windowMs)) {
        if (unitsToMatch <= 0n) break;

        const available = remainingUnits.get(lot.id);
        const matched = minBigInt(unitsToMatch, available);
        // Cap the running total: rounding each lot's share independently could
        // otherwise disallow a cent more than the loss actually was.
        const headroom = totalLoss - disposal.disallowedLossCents;
        const disallowed = minBigInt(allocate(totalLoss, matched, disposal.units), headroom);
        if (disallowed <= 0n) continue;

        disposal.disallowedLossCents += disallowed;
        disposal.washSale = true;
        disposal.replacementLotIds.push(lot.id);

        creditReplacementBasis(lot, disallowed, disposalsByLot);
        lot.holdingStartAt = Math.min(lot.holdingStartAt, disposal.holdingStartAt);

        remainingUnits.set(lot.id, available - matched);
        unitsToMatch -= matched;
    }
};

/**
 * Applies wash sale treatment across a completed set of disposals.
 * Mutates the disposals and lots in place and returns the total disallowed.
 *
 * @param {Array<object>} disposals - every disposal produced by the engine
 * @param {Array<object>} lots - every lot created, open or exhausted
 * @param {{windowDays?: number}} [options]
 * @returns {{disallowedCents: bigint, adjustedCount: number}}
 */
export const applyWashSales = (disposals, lots, options = {}) => {
    const windowMs = (options.windowDays ?? WASH_SALE_WINDOW_DAYS) * DAY_MS;
    const disposalsByLot = indexDisposalsByLot(disposals);
    const remainingUnits = new Map(lots.map((lot) => [lot.id, lot.originalUnits]));

    const losses = disposals
        .filter((disposal) => disposal.rawGainCents < 0n)
        .sort((a, b) => a.soldAt - b.soldAt || a.sequence - b.sequence);

    for (const disposal of losses) {
        washOneDisposal(disposal, lots, remainingUnits, disposalsByLot, windowMs);
    }

    const disallowedCents = disposals.reduce((sum, disposal) => sum + disposal.disallowedLossCents, 0n);
    const adjustedCount = disposals.filter((disposal) => disposal.washSale).length;
    return { disallowedCents, adjustedCount };
};
