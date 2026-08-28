import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateGains } from '../gains.js';
import { TERM } from '../holdingPeriod.js';

/** Dollars to integer cents, for readable expectations. */
const usd = (dollars) => BigInt(Math.round(dollars * 100));

const run = (history, options = {}) => calculateGains(history, { applyWashSale: false, ...options });

test('FIFO: proceeds less basis, with the oldest lot consumed first', () => {
    const { disposals, summary } = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '20000' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '0.5', price: '30000' },
    ]);

    assert.equal(disposals.length, 1);
    assert.equal(disposals[0].proceedsCents, usd(15000));
    assert.equal(disposals[0].basisCents, usd(10000));
    assert.equal(disposals[0].gainCents, usd(5000));
    assert.equal(summary.netGainCents, usd(5000));
});

test('fees are added to basis on the buy and netted from proceeds on the sell', () => {
    const { summary } = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '10000', fee: '50' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '1.0', price: '20000', fee: '50' },
    ]);

    // (20000 - 50) - (10000 + 50)
    assert.equal(summary.netGainCents, usd(9900));
});

/**
 * The regression that mattered most: the service ignored its `method`
 * argument entirely, so HIFO and LIFO both silently returned FIFO numbers.
 */
test('FIFO, LIFO and HIFO select different lots', () => {
    const history = [
        { id: 'expensive', type: 'BUY', date: '2023-02-01', amount: '1.0', price: '50000' },
        { id: 'cheap', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '10000' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '1.0', price: '30000' },
    ];

    assert.equal(run(history, { method: 'FIFO' }).summary.netGainCents, usd(20000));
    assert.equal(run(history, { method: 'LIFO' }).summary.netGainCents, usd(-20000));
    assert.equal(run(history, { method: 'HIFO' }).summary.netGainCents, usd(-20000));

    assert.equal(run(history, { method: 'HIFO' }).disposals[0].lotId, 'lot:expensive');
    assert.equal(run(history, { method: 'FIFO' }).disposals[0].lotId, 'lot:cheap');
});

test('rejects an unknown cost basis method instead of falling back to FIFO', () => {
    assert.throws(() => run([], { method: 'AVERAGE' }), /Unknown cost basis method/);
});

test('holding period: one year exactly is short term, one day more is long', () => {
    const { disposals } = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '2.0', price: '10000' },
        { id: 's1', type: 'SELL', date: '2024-01-01', amount: '1.0', price: '20000' },
        { id: 's2', type: 'SELL', date: '2024-01-02', amount: '1.0', price: '20000' },
    ]);

    assert.equal(disposals[0].term, TERM.SHORT);
    assert.equal(disposals[1].term, TERM.LONG);
});

test('summary splits the result into short and long term', () => {
    const { summary } = run([
        { id: 'b1', type: 'BUY', date: '2022-01-01', amount: '1.0', price: '10000' },
        { id: 'b2', type: 'BUY', date: '2023-11-01', amount: '1.0', price: '10000' },
        { id: 's1', type: 'SELL', date: '2023-12-01', amount: '2.0', price: '20000' },
    ]);

    assert.equal(summary.shortTermCount, 1);
    assert.equal(summary.longTermCount, 1);
    assert.equal(summary.shortTermGainCents + summary.longTermGainCents, summary.netGainCents);
});

test('every disposal carries the acquisition date the 8949 requires', () => {
    const { disposals } = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '10000' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '1.0', price: '20000' },
    ]);

    assert.equal(disposals[0].acquiredDate, '2023-01-01');
    assert.equal(disposals[0].soldDate, '2023-06-01');
});

test('selling more than the inventory reports zero basis and warns', () => {
    const { disposals, summary, warnings } = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '10000' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '1.5', price: '20000' },
    ]);

    assert.equal(disposals.length, 2);
    assert.equal(disposals[1].lotId, null);
    assert.equal(disposals[1].basisCents, 0n);
    assert.equal(summary.proceedsCents, usd(30000), 'no proceeds are dropped');
    assert.equal(warnings.some((warning) => warning.code === 'INSUFFICIENT_INVENTORY'), true);
});

test('frozen lots are held back from selection', () => {
    const history = [
        { id: 'cold', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '10000' },
        { id: 'hot', type: 'BUY', date: '2023-02-01', amount: '1.0', price: '20000' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '1.0', price: '30000' },
    ];
    const lotState = { 'lot:cold': { frozen: true, label: 'KYC-free' } };

    const held = run(history, { method: 'FIFO', respectFrozen: true, lotState });
    assert.equal(held.disposals[0].lotId, 'lot:hot');
    assert.equal(held.openLots[0].id, 'lot:cold');

    // FIFO would otherwise have spent the older, frozen lot.
    const ignored = run(history, { method: 'FIFO', respectFrozen: false, lotState });
    assert.equal(ignored.disposals[0].lotId, 'lot:cold');
});

test('spending a frozen lot when nothing else is left is flagged, not hidden', () => {
    const { disposals, warnings } = run([
        { id: 'cold', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '10000' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '1.0', price: '30000' },
    ], { respectFrozen: true, lotState: { 'lot:cold': { frozen: true } } });

    assert.equal(disposals[0].fromFrozenLot, true);
    assert.equal(warnings.some((warning) => warning.code === 'FROZEN_LOT_SPENT'), true);
});

test('lot ids are stable and do not shift as inventory is consumed', () => {
    // The old id embedded the live inventory index, so freezing or labelling a
    // lot silently re-bound to a different one after the first sale.
    const { lots } = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '10000' },
        { id: 'b2', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '10000' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '1.0', price: '20000' },
        { id: 'b3', type: 'BUY', date: '2023-07-01', amount: '1.0', price: '10000' },
    ]);

    assert.deepEqual(lots.map((lot) => lot.id), ['lot:b1', 'lot:b2', 'lot:b3']);
});

test('splitting a lot never creates or destroys a cent', () => {
    const { disposals, summary } = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '0.1', price: '10000' },
        { id: 'b2', type: 'BUY', date: '2023-01-02', amount: '0.2', price: '10000' },
        { id: 's1', type: 'SELL', date: '2023-06-01', amount: '0.3', price: '10000' },
    ]);

    assert.equal(summary.netGainCents, 0n, 'buying and selling at the same price nets exactly zero');
    assert.equal(disposals.reduce((total, d) => total + d.proceedsCents, 0n), usd(3000));
    assert.equal(disposals.reduce((total, d) => total + d.basisCents, 0n), usd(3000));
});

test('a lot split across many sales retains its full basis', () => {
    const history = [{ id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1', price: '30000', fee: '7.77' }];
    for (let i = 0; i < 7; i += 1) {
        history.push({ id: `s${i}`, type: 'SELL', date: '2023-06-01', amount: '0.142857', price: '30000' });
    }

    const { disposals, openLots } = run(history);
    const distributed = disposals.reduce((total, d) => total + d.basisCents, 0n);
    const remaining = openLots.reduce((total, lot) => total + lot.basisCents, 0n);

    assert.equal(distributed + remaining, usd(30007.77));
});

test('ETH is handled at 18 decimals without precision loss', () => {
    const { summary } = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '10.0', price: '1200', fee: '5' },
        { id: 's1', type: 'SELL', date: '2023-05-15', amount: '5.0', price: '1800', fee: '10' },
    ], { asset: 'ETH' });

    // Proceeds 9000 - 10 fee = 8990. Basis: half of (12000 + 5) = 6002.50.
    assert.equal(summary.netGainCents, usd(8990 - 6002.5));
});

test('transactions are ordered by date regardless of input order', () => {
    const { transactions } = run([
        { id: 'late', type: 'BUY', date: '2023-06-01', amount: '1', price: '100' },
        { id: 'early', type: 'BUY', date: '2023-01-01', amount: '1', price: '100' },
    ]);

    assert.deepEqual(transactions.map((tx) => tx.id), ['early', 'late']);
});

test('rejects malformed history rather than computing something wrong', () => {
    assert.throws(() => run([{ id: 'x', type: 'GIFT', date: '2023-01-01', amount: '1', price: '1' }]), /unknown type/);
    assert.throws(() => run([{ id: 'x', type: 'BUY', date: '2023-13-01', amount: '1', price: '1' }]), /Date does not exist/);
    assert.throws(() => run([{ id: 'x', type: 'BUY', date: '2023-01-01', amount: '0', price: '1' }]), /non-positive/);
    assert.throws(() => run([{ id: 'x', type: 'BUY', date: '2023-01-01', amount: '1', price: '-5' }]), /negative price/);
    assert.throws(() => run([
        { id: 'dup', type: 'BUY', date: '2023-01-01', amount: '1', price: '1' },
        { id: 'dup', type: 'BUY', date: '2023-01-02', amount: '1', price: '1' },
    ]), /Duplicate transaction id/);
    assert.throws(() => run([], { asset: 'DOGE' }), /Unsupported asset/);
});

test('an empty history produces an empty, well-formed report', () => {
    const result = run([]);
    assert.deepEqual(result.disposals, []);
    assert.deepEqual(result.openLots, []);
    assert.equal(result.summary.netGainCents, 0n);
});
