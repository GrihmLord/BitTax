import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateGains } from '../gains.js';
import { TERM } from '../holdingPeriod.js';

const usd = (dollars) => BigInt(Math.round(dollars * 100));
const run = (history, options = {}) => calculateGains(history, { applyWashSale: true, ...options });

const lot = (result, id) => result.lots.find((entry) => entry.id === id);

/**
 * The previous implementation simply set the loss to zero. That overstates
 * income twice: once now, because the loss vanishes instead of being deferred,
 * and again later, because the replacement lot keeps an unadjusted basis.
 */
test('a disallowed loss is added to the replacement lot basis, not deleted', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-15', amount: '1.0', price: '42000' },
    ]);

    const [disposal] = result.disposals;
    assert.equal(disposal.washSale, true);
    assert.equal(disposal.disallowedLossCents, usd(10000));
    assert.equal(disposal.gainCents, 0n);
    assert.deepEqual(disposal.replacementLotIds, ['lot:b2']);

    // 42,000 paid plus the 10,000 loss that was disallowed.
    assert.equal(lot(result, 'lot:b2').basisCents, usd(52000));
    assert.equal(lot(result, 'lot:b2').washAdjustmentCents, usd(10000));
});

test('only the replaced portion of a loss is disallowed', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '2.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '2.0', price: '40000' },
        // Only half the position is bought back.
        { id: 'b2', type: 'BUY', date: '2023-02-10', amount: '1.0', price: '42000' },
    ]);

    const [disposal] = result.disposals;
    assert.equal(disposal.disallowedLossCents, usd(10000), 'half of the 20,000 loss');
    assert.equal(disposal.gainCents, usd(-10000), 'the other half stays deductible');
    assert.equal(lot(result, 'lot:b2').basisCents, usd(52000));
});

test('a repurchase outside the 61 day window is not a replacement', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-06-01', amount: '1.0', price: '42000' },
    ]);

    assert.equal(result.disposals[0].washSale, false);
    assert.equal(result.disposals[0].gainCents, usd(-10000));
    assert.equal(lot(result, 'lot:b2').basisCents, usd(42000));
});

/** Section 1091 covers the 30 days *before* a sale as well as the 30 after. */
test('a purchase made before the sale can be the replacement', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2022-01-01', amount: '1.0', price: '50000' },
        { id: 'b2', type: 'BUY', date: '2023-01-20', amount: '1.0', price: '42000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
    ], { method: 'FIFO' });

    const disposal = result.disposals.find((entry) => entry.lotId === 'lot:b1');
    assert.equal(disposal.washSale, true);
    assert.equal(disposal.gainCents, 0n);
    assert.equal(lot(result, 'lot:b2').basisCents, usd(52000));
});

/**
 * When the replacement has itself already been sold, the basis increase has to
 * follow through to that sale, otherwise the deferred loss is lost for good.
 */
test('an adjustment cascades onto a replacement that was already sold', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-15', amount: '1.0', price: '42000' },
        { id: 's2', type: 'SELL', date: '2024-02-01', amount: '1.0', price: '60000' },
    ]);

    const second = result.disposals.find((entry) => entry.lotId === 'lot:b2');
    assert.equal(second.basisCents, usd(52000), 'the deferred loss lifted the basis');
    assert.equal(second.gainCents, usd(8000), '60,000 proceeds less the 52,000 adjusted basis');

    // Nothing is created or destroyed: the two disposals together report the
    // real economic result of -10,000 then +18,000.
    assert.equal(result.summary.netGainCents, usd(8000));
});

test('the replacement inherits the washed position holding period', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-15', amount: '1.0', price: '42000' },
        // Less than a year after buying b2, but more than a year after b1.
        { id: 's2', type: 'SELL', date: '2024-02-01', amount: '1.0', price: '60000' },
    ]);

    const second = result.disposals.find((entry) => entry.lotId === 'lot:b2');
    assert.equal(second.term, TERM.LONG, 'holding period tacking applies');
});

test('a gain is never treated as a wash sale', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '40000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '50000' },
        { id: 'b2', type: 'BUY', date: '2023-02-05', amount: '1.0', price: '48000' },
    ]);

    assert.equal(result.disposals[0].washSale, false);
    assert.equal(result.disposals[0].gainCents, usd(10000));
});

test('a replacement lot is consumed once and cannot absorb a second loss', () => {
    const result = run([
        // Acquired long before the sales, so the two old lots cannot act as
        // replacements for each other — only b3 is inside the window.
        { id: 'b1', type: 'BUY', date: '2022-01-01', amount: '1.0', price: '50000' },
        { id: 'b2', type: 'BUY', date: '2022-01-02', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 's2', type: 'SELL', date: '2023-02-02', amount: '1.0', price: '40000' },
        // A single 1.0 repurchase against two separate 1.0 losses.
        { id: 'b3', type: 'BUY', date: '2023-02-10', amount: '1.0', price: '42000' },
    ]);

    const disallowed = result.disposals.reduce((total, d) => total + d.disallowedLossCents, 0n);
    assert.equal(disallowed, usd(10000), 'only one of the two losses can be washed');
    assert.equal(lot(result, 'lot:b3').washAdjustmentCents, usd(10000));

    const washed = result.disposals.filter((d) => d.washSale);
    assert.equal(washed.length, 1);
});

test('the amount disallowed never exceeds the loss itself', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '3.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '3.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-03', amount: '1.0', price: '41000' },
        { id: 'b3', type: 'BUY', date: '2023-02-04', amount: '1.0', price: '41000' },
        { id: 'b4', type: 'BUY', date: '2023-02-05', amount: '1.0', price: '41000' },
    ]);

    const [disposal] = result.disposals;
    assert.equal(disposal.disallowedLossCents, usd(30000));
    assert.equal(disposal.gainCents, 0n);
    assert.ok(disposal.disallowedLossCents <= -disposal.rawGainCents);
});

test('the rule can be switched off, since it may not apply to digital assets', () => {
    const history = [
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-15', amount: '1.0', price: '42000' },
    ];

    const off = run(history, { applyWashSale: false });
    assert.equal(off.disposals[0].washSale, false);
    assert.equal(off.disposals[0].gainCents, usd(-10000));
    assert.equal(lot(off, 'lot:b2').basisCents, usd(42000));
});
