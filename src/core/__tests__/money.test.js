import test from 'node:test';
import assert from 'node:assert/strict';

import { valueOf, priceFrom, allocate, parsePrice, parseUSD, formatUSD, usdToDecimalString, percentOf, ratioOf } from '../money.js';
import { parseUnits } from '../decimal.js';

test('values a holding in exact cents', () => {
    // 1 BTC at $20,000
    assert.equal(valueOf(parseUnits('1', 8), 8, parsePrice('20000')), 2000000n);
    // 0.5 BTC at $30,000
    assert.equal(valueOf(parseUnits('0.5', 8), 8, parsePrice('30000')), 1500000n);
    // 1 ETH at $1,200 — 18 decimals must not overflow or lose precision
    assert.equal(valueOf(parseUnits('1', 18), 18, parsePrice('1200')), 120000n);
    // A single satoshi at $45,000 rounds to 5 hundredths of a cent -> 0
    assert.equal(valueOf(1n, 8, parsePrice('45000')), 0n);
    // 1000 satoshis at $45,000 is 45 cents
    assert.equal(valueOf(1000n, 8, parsePrice('45000')), 45n);
});

test('priceFrom inverts valueOf when the value lands on a whole cent', () => {
    const units = parseUnits('2', 8);
    const price = parsePrice('18450.25');

    assert.equal(valueOf(units, 8, price), 3690050n);
    assert.equal(priceFrom(3690050n, units, 8), price);
});

test('priceFrom derives the effective unit price a fee produces', () => {
    // 1 BTC at $10,000 plus a $50 fee costs $10,050 per whole coin.
    const units = parseUnits('1', 8);
    assert.equal(priceFrom(1005000n, units, 8), parsePrice('10050'));
});

test('allocate splits a total in proportion', () => {
    assert.equal(allocate(1000n, 1n, 4n), 250n);
    assert.equal(allocate(1000n, 1n, 3n), 333n);
    assert.equal(allocate(1000n, 3n, 3n), 1000n);
    assert.throws(() => allocate(100n, 1n, 0n), /zero total/);
});

test('formatUSD renders exact cents, including beyond float safety', () => {
    assert.equal(formatUSD(0n), '$0.00');
    assert.equal(formatUSD(12345n), '$123.45');
    assert.equal(formatUSD(-12345n), '-$123.45');
    assert.equal(formatUSD(200000000n), '$2,000,000.00');
    assert.equal(formatUSD(5n), '$0.05');
});

test('usdToDecimalString always keeps two places for machine output', () => {
    assert.equal(usdToDecimalString(0n), '0.00');
    assert.equal(usdToDecimalString(-12345n), '-123.45');
    assert.equal(usdToDecimalString(100n), '1.00');
});

test('parseUSD refuses sub-cent precision rather than rounding silently', () => {
    assert.equal(parseUSD('12.34'), 1234n);
    assert.throws(() => parseUSD('12.345'), /decimal places/);
});

/** The dashboard used to divide by a zero portfolio and render "NaN%". */
test('percentages return null instead of NaN on an empty denominator', () => {
    assert.equal(percentOf(100n, 0n), null);
    assert.equal(percentOf(100n, -5n), null);
    assert.equal(percentOf(5000n, 10000n), '50.0%');
    assert.equal(percentOf(-2500n, 10000n), '-25.0%');
    assert.equal(percentOf(1n, 3n), '33.3%');
});

test('ratioOf is safe at the edges', () => {
    assert.equal(ratioOf(100n, 0n), 0);
    assert.equal(ratioOf(-1n, 100n), 0);
    assert.equal(ratioOf(50n, 100n), 0.5);
    assert.equal(ratioOf(100n, 100n), 1);
});
