import test from 'node:test';
import assert from 'node:assert/strict';

import {
    P, N, G, INFINITY, mod, powMod, inverse, isOnCurve, pointAdd, pointDouble,
    pointNegate, pointEquals, scalarMultiply, decompressPoint, compressPoint,
    bytesToBigInt, bigIntTo32Bytes, selfTest,
} from '../secp256k1.js';

test('the built-in self test passes', () => {
    const report = selfTest();
    assert.deepEqual(report.failures, []);
    assert.equal(report.ok, true);
});

test('curve parameters are the published secp256k1 values', () => {
    // p = 2^256 - 2^32 - 977
    assert.equal(P, 2n ** 256n - 2n ** 32n - 977n);
    // Both p and n are prime, and n is very close to p.
    assert.ok(N < P);
    assert.ok(isOnCurve(G));
});

test('modular helpers behave at the edges', () => {
    assert.equal(mod(-1n), P - 1n);
    assert.equal(mod(P), 0n);
    assert.equal(powMod(2n, 0n), 1n);
    assert.equal(powMod(2n, 10n, 1000n), 24n);
    assert.throws(() => powMod(2n, -1n), /non-negative/);
    assert.throws(() => inverse(0n), /no modular inverse/);
});

test('an inverse multiplied back gives one', () => {
    for (const value of [1n, 2n, 3n, 12345678901234567890n, P - 1n]) {
        assert.equal(mod(value * inverse(value)), 1n, `inverse of ${value}`);
    }
});

test('the group law holds', () => {
    const g2 = scalarMultiply(2n);
    const g3 = scalarMultiply(3n);
    const g7 = scalarMultiply(7n);

    assert.ok(pointEquals(pointAdd(G, G), pointDouble(G)));
    assert.ok(pointEquals(pointAdd(g3, scalarMultiply(4n)), g7));
    // Commutativity.
    assert.ok(pointEquals(pointAdd(g2, g3), pointAdd(g3, g2)));
    // Associativity.
    assert.ok(pointEquals(pointAdd(pointAdd(G, g2), g3), pointAdd(G, pointAdd(g2, g3))));
    // Identity.
    assert.ok(pointEquals(pointAdd(g3, INFINITY), g3));
    assert.ok(pointEquals(pointAdd(INFINITY, g3), g3));
});

test('every multiple of G stays on the curve', () => {
    for (const k of [1n, 2n, 3n, 255n, 65537n, N - 1n]) {
        assert.ok(isOnCurve(scalarMultiply(k)), `${k}G`);
    }
});

test('inverses annihilate', () => {
    assert.equal(pointAdd(G, pointNegate(G)), INFINITY);
    assert.equal(pointAdd(scalarMultiply(N - 1n), G), INFINITY);
    assert.ok(pointEquals(scalarMultiply(N - 1n), pointNegate(G)));
});

test('scalar multiplication is linear', () => {
    // (a + b)G == aG + bG, which exercises the ladder against the addition law.
    const a = 0x1234567890abcdefn;
    const b = 0xfedcba0987654321n;
    assert.ok(pointEquals(scalarMultiply(a + b), pointAdd(scalarMultiply(a), scalarMultiply(b))));
});

test('compression round-trips and records y parity', () => {
    for (const k of [1n, 2n, 5n, 999n]) {
        const point = scalarMultiply(k);
        const compressed = compressPoint(point);

        assert.equal(compressed.length, 33);
        assert.equal(compressed[0], (point.y & 1n) === 1n ? 0x03 : 0x02);
        assert.ok(pointEquals(decompressPoint(compressed), point), `${k}G round-trip`);
    }
});

test('the two prefixes select the two roots', () => {
    const point = scalarMultiply(5n);
    const compressed = compressPoint(point);
    const flipped = Uint8Array.from(compressed);
    flipped[0] = compressed[0] === 0x02 ? 0x03 : 0x02;

    const other = decompressPoint(flipped);
    assert.equal(other.x, point.x);
    assert.equal(other.y, mod(-point.y));
    assert.ok(isOnCurve(other));
});

test('malformed public keys are rejected', () => {
    assert.throws(() => decompressPoint(new Uint8Array(32)), /33 bytes/);
    assert.throws(() => decompressPoint('not bytes'), /33 bytes/);

    const badPrefix = new Uint8Array(33);
    badPrefix[0] = 0x04;
    assert.throws(() => decompressPoint(badPrefix), /prefix/);

    // x = 7 has no square root of x^3 + 7 on this curve.
    const offCurve = new Uint8Array(33);
    offCurve[0] = 0x02;
    offCurve[32] = 0x07;
    assert.throws(() => decompressPoint(offCurve), /not a point on secp256k1/);

    // An x coordinate at or beyond the field prime is out of range.
    const tooLarge = new Uint8Array(33);
    tooLarge[0] = 0x02;
    tooLarge.fill(0xff, 1);
    assert.throws(() => decompressPoint(tooLarge), /not in the field/);
});

test('the point at infinity has no encoding', () => {
    assert.throws(() => compressPoint(INFINITY), /point at infinity/);
});

test('byte and bigint conversion round-trip', () => {
    for (const value of [0n, 1n, 255n, 256n, P - 1n]) {
        assert.equal(bytesToBigInt(bigIntTo32Bytes(value)), value);
    }
    assert.equal(bigIntTo32Bytes(1n).length, 32);
});
