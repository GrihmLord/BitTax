/**
 * washsale.js
 * IRS-style wash sale treatment (26 U.S.C. 1091, 1223(3); Treas. Reg. 1.1091-1;
 * Pub 550).
 *
 * A loss is disallowed to the extent substantially identical property was
 * acquired within 30 days before or after the sale — a 61 day window counted
 * in calendar days. The disallowed loss is not deleted: it is added to the
 * cost basis of the replacement units, and those units inherit the holding
 * period of the position that was washed.
 *
 * Matching rules implemented here:
 *   - Replacements are matched in the order they were acquired (Reg. 1.1091-1(c)).
 *   - Only the replacement units carry the adjustment. A partial match splits
 *     the replacement lot into a separate tranche rather than smearing the
 *     adjustment across units that replaced nothing.
 *   - Each unit can act as a replacement once (Reg. 1.1091-1(e)).
 *   - Other units from the purchase that was sold are not replacements for it
 *     (Rev. Rul. 56-602).
 *   - A unit acquired inside the window but already sold before the loss sale
 *     is no longer held and does not count.
 *
 * The engine calls `washDisposal` at the moment each loss is realised, in
 * chronological order. A replacement's adjusted basis is therefore in place
 * before it is itself sold, so a loss on the replacement is tested in turn —
 * cascades are handled by construction instead of by a second pass.
 *
 * NOTE ON APPLICABILITY: section 1091 is written for "stocks or securities".
 * Digital assets are generally treated as property rather than securities, so
 * this treatment is conservative and optional. It is applied only when the
 * caller asks for it, and every adjustment is reported line by line.
 */

import { allocate } from './money.js';
import { minBigInt } from './decimal.js';
import { tackedHoldingStart } from './holdingPeriod.js';

export const WASH_SALE_WINDOW_DAYS = 30;

/** Index of the first lot acquired on or after `day`. Lots are in acquisition order. */
const lowerBound = (lots, day) => {
    let low = 0;
    let high = lots.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (lots[mid].acquiredDay < day) low = mid + 1;
        else high = mid;
    }
    return low;
};

/**
 * Every lot the engine will ever hold, in acquisition order, including ones
 * not yet acquired at the point in the timeline being processed. Future
 * purchases inside the window are valid replacements, so they must be visible.
 */
export class ReplacementIndex {
    /** @param {Array<object>} lots - in acquisition order */
    constructor(lots) {
        this.lots = [...lots];
    }

    /** Positions of lots acquired within `windowDays` of `day`, inclusive. */
    windowStart(day, windowDays) {
        return lowerBound(this.lots, day - windowDays);
    }
}

/**
 * Tests one loss disposal line against the replacement index, and records the
 * disallowance on both sides.
 *
 * @param {object} disposal - a disposal line with a negative raw gain
 * @param {object} soldLot - the lot the line was drawn from
 * @param {ReplacementIndex} index
 * @param {object} hooks
 * @param {(lot: object, units: bigint) => object} hooks.split - carves a tranche out of a lot and places it in inventory
 * @param {(lot: object) => void} hooks.adjusted - called after a lot's basis changes
 * @param {number} [windowDays]
 */
export const washDisposal = (disposal, soldLot, index, hooks, windowDays = WASH_SALE_WINDOW_DAYS) => {
    const totalLoss = -disposal.rawGainCents;
    if (totalLoss <= 0n || !soldLot) return;

    const soldDay = disposal.soldDay;
    let unitsToMatch = disposal.units;

    for (let i = index.windowStart(soldDay, windowDays); i < index.lots.length && unitsToMatch > 0n; i += 1) {
        const candidate = index.lots[i];
        if (candidate.acquiredDay > soldDay + windowDays) break;
        if (candidate.originId === soldLot.originId) continue;
        if (candidate.replacementFor !== null || candidate.units <= 0n) continue;

        const matched = minBigInt(unitsToMatch, candidate.units);
        // Cap the running total: rounding each lot's share independently could
        // otherwise disallow a cent more than the loss actually was.
        const headroom = totalLoss - disposal.disallowedLossCents;
        const disallowed = minBigInt(allocate(totalLoss, matched, disposal.units), headroom);
        if (disallowed <= 0n) break;

        let replacement = candidate;
        if (matched < candidate.units) {
            replacement = hooks.split(candidate, matched);
            // The tranche sits directly after its parent, and is skipped by the loop.
            index.lots.splice(i + 1, 0, replacement);
            i += 1;
        }

        replacement.replacementFor = disposal.id;
        replacement.basisCents += disallowed;
        replacement.washAdjustmentCents += disallowed;
        replacement.holdingStartAt = tackedHoldingStart(replacement.acquiredAt, disposal.holdingStartAt, disposal.soldAt);
        hooks.adjusted(replacement);

        disposal.disallowedLossCents += disallowed;
        disposal.washSale = true;
        disposal.replacementLotIds.push(replacement.id);
        unitsToMatch -= matched;
    }
};
