/**
 * lots.js
 * Tax lot construction, splitting, and disposal-order strategies.
 *
 * A lot carries its remaining cost basis in whole cents rather than a unit
 * price, so consuming part of a lot allocates basis proportionally and the sum
 * of the parts always equals the original basis.
 *
 * Lots are identified two ways:
 *   - `originId` (`lot:<txId>`) names the purchase. Coin-control state —
 *     freezes and labels — hangs off this, because it is what the user sees.
 *   - `id` names a specific tranche. A wash sale adjusts only the units that
 *     actually replaced the sold position, so it splits them into their own
 *     tranche (`lot:<txId>/w1`) carrying the adjusted basis and tacked
 *     holding period. Everywhere else `id === originId`.
 */

import { allocate } from './money.js';
import { minBigInt } from './decimal.js';

export const COST_BASIS_METHODS = Object.freeze(['FIFO', 'LIFO', 'HIFO']);

export const isCostBasisMethod = (method) => COST_BASIS_METHODS.includes(String(method || '').toUpperCase());

export const originIdFor = (txId) => `lot:${txId}`;

/**
 * Builds an open tax lot from a normalised BUY.
 *
 * Basis is the full consideration paid: the gross cost plus the acquisition
 * fee, which IRS Pub 551 treats as part of the cost of the property.
 */
export const createLot = (tx) => {
    const originId = originIdFor(tx.id);
    const basisCents = tx.grossCents + tx.feeCents;
    return {
        id: originId,
        originId,
        txId: tx.id,
        asset: tx.asset,
        decimals: tx.decimals,
        acquiredAt: tx.timestamp,
        acquiredDay: tx.day,
        acquiredDate: tx.date,
        txSequence: tx.sequence,
        tranche: 0,
        // Holding period can be pushed earlier by a wash sale (period tacking).
        holdingStartAt: tx.timestamp,
        units: tx.units,
        originalUnits: tx.units,
        basisCents,
        originalBasisCents: basisCents,
        washAdjustmentCents: 0n,
        /** Set when these units absorbed a wash sale; a unit can only do that once. */
        replacementFor: null,
        frozen: false,
        label: '',
    };
};

/**
 * Carves `units` out of a lot into a new tranche, moving a proportional share
 * of the remaining basis with them. Mutates `lot`.
 *
 * @returns {object} the new tranche
 */
export const splitLot = (lot, units, trancheNumber) => {
    if (units <= 0n || units >= lot.units) throw new RangeError('A split must leave units on both sides');
    const basisCents = allocate(lot.basisCents, units, lot.units);
    const washShare = allocate(lot.washAdjustmentCents, units, lot.units);

    lot.units -= units;
    lot.basisCents -= basisCents;
    lot.washAdjustmentCents -= washShare;

    return {
        ...lot,
        id: `${lot.originId}/w${trancheNumber}`,
        tranche: trancheNumber,
        units,
        originalUnits: units,
        basisCents,
        originalBasisCents: basisCents,
        washAdjustmentCents: washShare,
        replacementFor: null,
    };
};

/** Earliest acquisition first; source order and tranche break ties deterministically. */
const byAcquisition = (a, b) => a.acquiredAt - b.acquiredAt
    || a.txSequence - b.txSequence
    || a.tranche - b.tranche;

/**
 * Basis per unit compared exactly by cross-multiplication, never through a
 * rounded quotient: two lots a cent apart in total basis must still rank
 * correctly.
 */
const byHighestUnitBasis = (a, b) => {
    const left = b.basisCents * a.units;
    const right = a.basisCents * b.units;
    if (left > right) return 1;
    if (left < right) return -1;
    return byAcquisition(a, b);
};

const COMPARATORS = Object.freeze({
    FIFO: byAcquisition,
    LIFO: (a, b) => b.acquiredAt - a.acquiredAt || b.txSequence - a.txSequence || a.tranche - b.tranche,
    HIFO: byHighestUnitBasis,
});

export const comparatorFor = (method) => {
    const comparator = COMPARATORS[String(method || '').toUpperCase()];
    if (!comparator) {
        throw new RangeError(`Unknown cost basis method "${method}". Supported: ${COST_BASIS_METHODS.join(', ')}`);
    }
    return comparator;
};

/**
 * Binary min-heap with lazy invalidation. Every sale pops the lot to draw from
 * next, so a history of n purchases and m sales costs O((n + m) log n) instead
 * of re-sorting every open lot on every sale.
 *
 * Entries snapshot the lot's order key when pushed. A lot's key can change —
 * HIFO ranks by basis per unit, which a wash adjustment raises — so a changed
 * lot is simply pushed again. The newest entry for a lot supersedes the older
 * ones, which are discarded when they surface.
 */
class LotHeap {
    constructor(comparator) {
        this.compare = comparator;
        this.items = [];
        this.versions = new WeakMap();
        this.live = 0;
    }

    get size() { return this.live; }

    push(lot) {
        const previous = this.versions.get(lot);
        const version = Math.abs(previous ?? 0) + 1;
        if (previous === undefined || previous < 0) this.live += 1;
        this.versions.set(lot, version);

        const { items } = this;
        items.push({ lot, key: { ...lot }, version });
        let i = items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.compare(items[i].key, items[parent].key) >= 0) break;
            [items[i], items[parent]] = [items[parent], items[i]];
            i = parent;
        }
    }

    popEntry() {
        const { items } = this;
        const top = items[0];
        const last = items.pop();
        if (items.length > 0) {
            items[0] = last;
            let i = 0;
            for (;;) {
                const left = 2 * i + 1;
                const right = left + 1;
                let smallest = i;
                if (left < items.length && this.compare(items[left].key, items[smallest].key) < 0) smallest = left;
                if (right < items.length && this.compare(items[right].key, items[smallest].key) < 0) smallest = right;
                if (smallest === i) break;
                [items[i], items[smallest]] = [items[smallest], items[i]];
                i = smallest;
            }
        }
        return top;
    }

    /** True while the lot has a current entry in this heap. */
    has(lot) {
        return (this.versions.get(lot) ?? -1) > 0;
    }

    pop() {
        while (this.items.length > 0) {
            const entry = this.popEntry();
            if (this.versions.get(entry.lot) === entry.version) {
                // Negative marks "was here, now removed" so a re-push counts as live again.
                this.versions.set(entry.lot, -entry.version);
                this.live -= 1;
                return entry.lot;
            }
        }
        return null;
    }
}

/**
 * The open inventory of one asset, ordered for disposal.
 *
 * Frozen lots are held back rather than removed: a user who froze a UTXO for
 * privacy still has to account for a sale that actually happened, so frozen
 * inventory is only reached once every unfrozen lot is exhausted, and the
 * caller is told when that happened.
 */
export class LotPool {
    /**
     * @param {string} method - FIFO | LIFO | HIFO
     * @param {boolean} respectFrozen
     */
    constructor(method, respectFrozen = true) {
        const comparator = comparatorFor(method);
        this.respectFrozen = respectFrozen;
        this.active = new LotHeap(comparator);
        this.frozen = new LotHeap(comparator);
    }

    heapFor(lot) {
        return this.respectFrozen && lot.frozen ? this.frozen : this.active;
    }

    add(lot) {
        if (lot.units <= 0n) return;
        this.heapFor(lot).push(lot);
    }

    /** Re-ranks a lot already in the pool after its basis or units changed. */
    refresh(lot) {
        const heap = this.heapFor(lot);
        if (heap.has(lot)) heap.push(lot);
    }

    has(lot) {
        return this.heapFor(lot).has(lot);
    }

    /** Removes and returns the next lot to draw from, or null when empty. */
    next() {
        return this.active.pop() ?? this.frozen.pop();
    }

    get size() { return this.active.size + this.frozen.size; }
}

/**
 * Orders a list of open lots for disposal without consuming them.
 * Kept for callers that want to preview selection order.
 *
 * @param {Array<object>} openLots
 * @param {string} method
 * @param {boolean} [respectFrozen=true]
 * @returns {Array<object>}
 */
export const orderLotsForDisposal = (openLots, method, respectFrozen = true) => {
    const pool = new LotPool(method, respectFrozen);
    for (const lot of openLots) pool.add(lot);
    const ordered = [];
    for (let lot = pool.next(); lot; lot = pool.next()) ordered.push(lot);
    return ordered;
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
