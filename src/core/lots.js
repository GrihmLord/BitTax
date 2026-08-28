/**
 * lots.js
 * Tax lot construction and disposal-order strategies.
 *
 * A lot carries its remaining cost basis in whole cents rather than a
 * unit price, so consuming part of a lot allocates basis proportionally
 * and the sum of the parts always equals the original basis.
 */

import { allocate } from './money.js';
import { minBigInt } from './decimal.js';

export const COST_BASIS_METHODS = Object.freeze(['FIFO', 'LIFO', 'HIFO']);

export const isCostBasisMethod = (method) => COST_BASIS_METHODS.includes(String(method || '').toUpperCase());

/**
 * Builds an open tax lot from a BUY.
 *
 * Basis is the full consideration paid: quantity x price plus the acquisition
 * fee, which IRS Pub 551 treats as part of the cost of the property.
 *
 * @param {object} tx - a normalised BUY transaction
 * @param {bigint} grossCents - quantity x price, in cents
 * @returns {object} lot
 */
export const createLot = (tx, grossCents) => ({
    id: `lot:${tx.id}`,
    txId: tx.id,
    asset: tx.asset,
    decimals: tx.decimals,
    acquiredAt: tx.timestamp,
    acquiredDate: tx.date,
    // Holding period can be pushed earlier by a wash sale (period tacking).
    holdingStartAt: tx.timestamp,
    units: tx.units,
    originalUnits: tx.units,
    basisCents: grossCents + tx.feeCents,
    originalBasisCents: grossCents + tx.feeCents,
    washAdjustmentCents: 0n,
    frozen: false,
    label: '',
});

/** Remaining cost basis per whole unit, used only to rank lots for HIFO. */
const basisPerUnit = (lot) => {
    if (lot.units === 0n) return 0n;
    return allocate(lot.basisCents, 10n ** BigInt(lot.decimals), lot.units);
};

const COMPARATORS = Object.freeze({
    FIFO: (a, b) => a.acquiredAt - b.acquiredAt || a.sequence - b.sequence,
    LIFO: (a, b) => b.acquiredAt - a.acquiredAt || b.sequence - a.sequence,
    HIFO: (a, b) => {
        const diff = basisPerUnit(b) - basisPerUnit(a);
        if (diff > 0n) return 1;
        if (diff < 0n) return -1;
        return a.acquiredAt - b.acquiredAt;
    },
});

/**
 * Orders the open lots for disposal.
 *
 * Frozen lots are held back rather than removed: a user who froze a UTXO for
 * privacy still has to account for a sale that actually happened, so frozen
 * inventory is only reached once every unfrozen lot is exhausted, and the
 * caller is told when that happened.
 *
 * @param {Array<object>} openLots
 * @param {string} method - FIFO | LIFO | HIFO
 * @param {boolean} respectFrozen
 * @returns {Array<object>} lots in the order they should be consumed
 */
export const orderLotsForDisposal = (openLots, method, respectFrozen = true) => {
    const key = String(method || '').toUpperCase();
    const comparator = COMPARATORS[key];
    if (!comparator) {
        throw new RangeError(`Unknown cost basis method "${method}". Supported: ${COST_BASIS_METHODS.join(', ')}`);
    }

    const withSequence = openLots.map((lot, sequence) => Object.assign(lot, { sequence }));
    const spendable = withSequence.filter((lot) => lot.units > 0n);

    if (!respectFrozen) return spendable.sort(comparator);

    const unfrozen = spendable.filter((lot) => !lot.frozen).sort(comparator);
    const frozen = spendable.filter((lot) => lot.frozen).sort(comparator);
    return unfrozen.concat(frozen);
};

/**
 * Removes `units` from a lot and returns the basis that leaves with them.
 *
 * The final draw takes the whole remaining balance so that rounding can never
 * strand a cent inside an emptied lot.
 *
 * @param {object} lot
 * @param {bigint} units
 * @returns {bigint} basis in cents attributable to the withdrawn units
 */
export const drawFromLot = (lot, units) => {
    const taken = minBigInt(units, lot.units);
    if (taken <= 0n) return 0n;

    const basis = taken === lot.units ? lot.basisCents : allocate(lot.basisCents, taken, lot.units);
    lot.units -= taken;
    lot.basisCents -= basis;
    return basis;
};
