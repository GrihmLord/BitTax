import test from 'node:test';
import assert from 'node:assert/strict';

import { parseUnits, formatUnits, mulDiv, divRound, rescale, minBigInt, maxBigInt, absBigInt } from '../decimal.js';

test('parseUnits converts decimal strings to exact base units', () => {
    assert.equal(parseUnits('1', 8), 100000000n);
    assert.equal(parseUnits('0.5', 8), 50000000n);
    assert.equal(parseUnits('0.00000001', 8), 1n);
    assert.equal(parseUnits('21000', 2), 2100000n);
    assert.equal(parseUnits('-1.5', 8), -150000000n);
    assert.equal(parseUnits('.5', 8), 50000000n);
    assert.equal(parseUnits('+2', 0), 2n);
});

test('parseUnits routes Numbers through their exact decimal form', () => {
    // The classic float trap: 0.1 is not exactly 0.1 as a double.
    assert.equal(parseUnits(0.1, 8), 10000000n);
    assert.equal(parseUnits(0.1, 18), 100000000000000000n);
    assert.equal(parseUnits(0.3, 8), 30000000n);
    // Exponent notation must not leak an "e" into the digit parser.
    assert.equal(parseUnits(1e-7, 8), 10n);
    assert.equal(parseUnits(1e21, 0), 1000000000000000000000n);
});

test('parseUnits refuses input it cannot represent exactly', () => {
    assert.throws(() => parseUnits('0.000000001', 8), /decimal places/);
    assert.throws(() => parseUnits('1,000', 8), /Malformed/);
    assert.throws(() => parseUnits('abc', 8), /Malformed/);
    assert.throws(() => parseUnits('1.2.3', 8), /Malformed/);
    assert.throws(() => parseUnits('', 8), /empty/);
    assert.throws(() => parseUnits(Number.NaN, 8), /not finite/);
});

test('formatUnits round-trips through parseUnits', () => {
    for (const value of ['0', '1', '0.5', '123.45678901', '-7.0001']) {
        assert.equal(formatUnits(parseUnits(value, 8), 8), String(Number(value)));
    }
});

test('formatUnits honours trim and minimum fraction digits', () => {
    assert.equal(formatUnits(50000000n, 8), '0.5');
    assert.equal(formatUnits(50000000n, 8, { trim: false }), '0.50000000');
    assert.equal(formatUnits(0n, 2, { trim: false, minFractionDigits: 2 }), '0.00');
    assert.equal(formatUnits(-1234n, 2, { trim: false, minFractionDigits: 2 }), '-12.34');
    assert.equal(formatUnits(5n, 0), '5');
});

test('divRound rounds half away from zero', () => {
    assert.equal(divRound(5n, 2n), 3n);
    assert.equal(divRound(-5n, 2n), -3n);
    assert.equal(divRound(4n, 2n), 2n);
    assert.equal(divRound(1n, 3n), 0n);
    assert.equal(divRound(2n, 3n), 1n);
    assert.throws(() => divRound(1n, 0n), /positive denominator/);
});

test('mulDiv keeps full precision before dividing', () => {
    // A naive (a/denom)*b would lose everything here.
    assert.equal(mulDiv(1n, 1000000n, 1000000n), 1n);
    assert.equal(mulDiv(3n, 1n, 2n), 2n);
});

test('rescale converts between precisions and rounds on loss', () => {
    assert.equal(rescale(1n, 8, 18), 10000000000n);
    assert.equal(rescale(150n, 2, 0), 2n);
    assert.equal(rescale(149n, 2, 0), 1n);
});

test('bigint comparison helpers', () => {
    assert.equal(minBigInt(1n, 2n), 1n);
    assert.equal(maxBigInt(1n, 2n), 2n);
    assert.equal(absBigInt(-5n), 5n);
    assert.equal(absBigInt(5n), 5n);
});
