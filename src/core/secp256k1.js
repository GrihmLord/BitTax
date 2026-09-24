/**
 * secp256k1.js
 * Affine point arithmetic over the Bitcoin curve, in BigInt.
 *
 * Only what BIP32 public derivation needs: decompress a public key, add points,
 * multiply the generator by a scalar, compress the result. There is no private
 * key handling here and no signing — BitTax is watch-only, so the operations
 * that could move funds are simply absent.
 *
 * The curve is y^2 = x^3 + 7 over F_p, so a = 0 and the doubling formulas drop
 * a term. Single point additions stay affine for readability; scalar
 * multiplication runs in Jacobian coordinates (see below) and is cross-checked
 * against the affine ladder by the self-test.
 *
 * `selfTest()` checks the arithmetic against curve identities that hold by
 * mathematics rather than by remembered constants, so it detects an
 * implementation error without depending on a published vector being recalled
 * correctly.
 */

/** Field prime: 2^256 - 2^32 - 977. */
export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

/** Order of the generator. */
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** Curve coefficient b, in y^2 = x^3 + ax + b with a = 0. */
export const B = 7n;

export const G = Object.freeze({
    x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
    y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
});

/** The point at infinity, the identity of the group. */
export const INFINITY = null;

/** Always-positive modulus. */
export const mod = (value, modulus = P) => {
    const result = value % modulus;
    return result < 0n ? result + modulus : result;
};

/** Modular exponentiation by square-and-multiply. */
export const powMod = (base, exponent, modulus = P) => {
    if (exponent < 0n) throw new RangeError('powMod requires a non-negative exponent');

    let result = 1n;
    let acc = mod(base, modulus);
    let e = exponent;

    while (e > 0n) {
        if (e & 1n) result = (result * acc) % modulus;
        acc = (acc * acc) % modulus;
        e >>= 1n;
    }
    return result;
};

/**
 * Modular inverse via Fermat's little theorem: a^(p-2) = a^-1 for prime p.
 * Slower than the extended Euclidean algorithm, and much harder to get wrong.
 */
export const inverse = (value, modulus = P) => {
    const a = mod(value, modulus);
    if (a === 0n) throw new RangeError('Zero has no modular inverse');
    return powMod(a, modulus - 2n, modulus);
};

export const isOnCurve = (point) => {
    if (point === INFINITY) return true;
    const { x, y } = point;
    if (x < 0n || x >= P || y < 0n || y >= P) return false;
    return mod(y * y) === mod(x * x * x + B);
};

export const pointNegate = (point) => (point === INFINITY ? INFINITY : { x: point.x, y: mod(-point.y) });

export const pointEquals = (a, b) => {
    if (a === INFINITY || b === INFINITY) return a === b;
    return a.x === b.x && a.y === b.y;
};

/** Point doubling. With a = 0 the slope is 3x^2 / 2y. */
export const pointDouble = (point) => {
    if (point === INFINITY) return INFINITY;
    // A point of order 2 has y = 0; doubling it gives infinity. secp256k1 has
    // no such point, but the guard keeps the inverse below well defined.
    if (point.y === 0n) return INFINITY;

    const slope = mod(3n * point.x * point.x * inverse(2n * point.y));
    const x = mod(slope * slope - 2n * point.x);
    return { x, y: mod(slope * (point.x - x) - point.y) };
};

/** Point addition, falling back to doubling when the operands coincide. */
export const pointAdd = (a, b) => {
    if (a === INFINITY) return b;
    if (b === INFINITY) return a;

    if (a.x === b.x) {
        // Same x: either the same point (double) or mutual inverses (infinity).
        return mod(a.y + b.y) === 0n ? INFINITY : pointDouble(a);
    }

    const slope = mod((b.y - a.y) * inverse(b.x - a.x));
    const x = mod(slope * slope - a.x - b.x);
    return { x, y: mod(slope * (a.x - x) - a.y) };
};

/*
 * Jacobian coordinates for scalar multiplication.
 *
 * An affine point operation costs a modular inverse, and an inverse costs a
 * full modular exponentiation. Double-and-add over 256 bits in affine form
 * therefore performed ~380 exponentiations per multiplication, which made a
 * 200-address scan take ~14 s on the Electron main thread. In Jacobian form
 * (x = X/Z^2, y = Y/Z^3) doubling and addition need no inverse at all; one
 * inverse converts the result back.
 *
 * Formulas: dbl-2009-l and madd-2007-bl from the Explicit-Formulas Database,
 * specialised to a = 0. Only public data is ever multiplied here, so the
 * variable-time ladder leaks nothing worth protecting.
 */

const JACOBIAN_INFINITY = Object.freeze({ X: 1n, Y: 1n, Z: 0n });

const toJacobian = (point) => (point === INFINITY ? JACOBIAN_INFINITY : { X: point.x, Y: point.y, Z: 1n });

const fromJacobian = (point) => {
    if (point.Z === 0n) return INFINITY;
    const zInverse = inverse(point.Z);
    const zInverse2 = mod(zInverse * zInverse);
    return { x: mod(point.X * zInverse2), y: mod(point.Y * zInverse2 * zInverse) };
};

const jacobianDouble = ({ X, Y, Z }) => {
    if (Z === 0n || Y === 0n) return JACOBIAN_INFINITY;
    const A = mod(X * X);
    const B = mod(Y * Y);
    const C = mod(B * B);
    const XB = X + B;
    const D = mod(2n * (XB * XB - A - C));
    const E = 3n * A;
    const F = mod(E * E);
    const X3 = mod(F - 2n * D);
    return { X: X3, Y: mod(E * (D - X3) - 8n * C), Z: mod(2n * Y * Z) };
};

/** Adds an affine point `q` to a Jacobian point `p`. */
const jacobianAddAffine = (p, q) => {
    if (q === INFINITY) return p;
    if (p.Z === 0n) return toJacobian(q);

    const Z1Z1 = mod(p.Z * p.Z);
    const U2 = mod(q.x * Z1Z1);
    const S2 = mod(q.y * p.Z * Z1Z1);
    const H = mod(U2 - p.X);
    const r = mod(2n * (S2 - p.Y));

    if (H === 0n) return r === 0n ? jacobianDouble(p) : JACOBIAN_INFINITY;

    const HH = mod(H * H);
    const I = 4n * HH;
    const J = mod(H * I);
    const V = mod(p.X * I);
    const X3 = mod(r * r - J - 2n * V);
    const ZH = p.Z + H;
    return {
        X: X3,
        Y: mod(r * (V - X3) - 2n * p.Y * J),
        Z: mod(ZH * ZH - Z1Z1 - HH),
    };
};

/** Scalar multiplication, left-to-right double-and-add in Jacobian coordinates. */
export const scalarMultiply = (scalar, point = G) => {
    const k = mod(scalar, N);
    if (k === 0n || point === INFINITY) return INFINITY;

    let result = JACOBIAN_INFINITY;
    for (let bit = BigInt(k.toString(2).length - 1); bit >= 0n; bit -= 1n) {
        result = jacobianDouble(result);
        if ((k >> bit) & 1n) result = jacobianAddAffine(result, point);
    }
    return fromJacobian(result);
};

/** The original affine ladder, kept as an independent cross-check for the self-test. */
const scalarMultiplyAffine = (scalar, point = G) => {
    const k = mod(scalar, N);
    if (k === 0n || point === INFINITY) return INFINITY;

    let result = INFINITY;
    let addend = point;
    let remaining = k;
    while (remaining > 0n) {
        if (remaining & 1n) result = pointAdd(result, addend);
        addend = pointDouble(addend);
        remaining >>= 1n;
    }
    return result;
};

const bytesToBigInt = (bytes) => {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
};

const bigIntTo32Bytes = (value) => {
    const out = new Uint8Array(32);
    let remaining = value;
    for (let i = 31; i >= 0; i -= 1) {
        out[i] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return out;
};

/**
 * Decompresses a 33-byte SEC public key.
 *
 * Because p = 3 (mod 4), the square root of y^2 is y^2 raised to (p+1)/4. The
 * result is squared again and compared, which rejects an x that is not on the
 * curve rather than returning a bogus point.
 *
 * @param {Uint8Array} bytes - 33 bytes, prefix 0x02 or 0x03
 * @returns {{x: bigint, y: bigint}}
 */
export const decompressPoint = (bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 33) {
        throw new TypeError('A compressed public key is 33 bytes');
    }
    const prefix = bytes[0];
    if (prefix !== 0x02 && prefix !== 0x03) {
        throw new RangeError(`Bad compressed point prefix 0x${prefix.toString(16).padStart(2, '0')}`);
    }

    const x = bytesToBigInt(bytes.subarray(1));
    if (x >= P) throw new RangeError('Public key x coordinate is not in the field');

    const ySquared = mod(x * x * x + B);
    let y = powMod(ySquared, (P + 1n) / 4n);
    if (mod(y * y) !== ySquared) throw new RangeError('Public key is not a point on secp256k1');

    // The prefix records the parity of y; take the other root when it disagrees.
    const wantOdd = prefix === 0x03;
    const isOdd = (y & 1n) === 1n;
    if (isOdd !== wantOdd) y = mod(-y);

    return { x, y };
};

/**
 * @param {{x: bigint, y: bigint}} point
 * @returns {Uint8Array} 33 bytes
 */
export const compressPoint = (point) => {
    if (point === INFINITY) throw new RangeError('The point at infinity has no encoding');

    const out = new Uint8Array(33);
    out[0] = (point.y & 1n) === 1n ? 0x03 : 0x02;
    out.set(bigIntTo32Bytes(point.x), 1);
    return out;
};

/**
 * Verifies the arithmetic against identities that hold by definition of the
 * group, so a mistake is caught without relying on a memorised test vector.
 *
 * @returns {{ok: boolean, failures: Array<string>}}
 */
export const selfTest = () => {
    const failures = [];
    const check = (name, condition) => { if (!condition) failures.push(name); };

    check('G lies on the curve', isOnCurve(G));
    check('G + G equals 2G', pointEquals(pointAdd(G, G), pointDouble(G)));
    check('2G lies on the curve', isOnCurve(pointDouble(G)));

    const g2 = scalarMultiply(2n);
    const g3 = scalarMultiply(3n);
    const g5 = scalarMultiply(5n);
    check('2G + 3G equals 5G', pointEquals(pointAdd(g2, g3), g5));
    check('G + (-G) is infinity', pointAdd(G, pointNegate(G)) === INFINITY);
    // (n-1)G = -G, so adding G must land on infinity. This exercises the full
    // scalar ladder against the group order rather than short-circuiting.
    check('(n-1)G equals -G', pointEquals(scalarMultiply(N - 1n), pointNegate(G)));
    check('(n-1)G + G is infinity', pointAdd(scalarMultiply(N - 1n), G) === INFINITY);
    check('compression round-trips', pointEquals(decompressPoint(compressPoint(g3)), g3));

    // The fast Jacobian ladder must agree with the plain affine one on an
    // arbitrary full-width scalar — two independent formula sets, one answer.
    const probe = 0x1f3a5c7e9b2d4f6081a3c5e7092b4d6f8e0c2a4b6d8f0e1c3a5b7d9f1e3c5a7bn;
    check('Jacobian and affine multiplication agree', pointEquals(scalarMultiply(probe), scalarMultiplyAffine(probe)));

    // An x with no square root must be rejected rather than silently accepted.
    let rejectedOffCurve = false;
    try {
        const bogus = new Uint8Array(33);
        bogus[0] = 0x02;
        bogus[32] = 0x07;
        decompressPoint(bogus);
    } catch {
        rejectedOffCurve = true;
    }
    check('off-curve x is rejected', rejectedOffCurve);

    return { ok: failures.length === 0, failures };
};

export { bytesToBigInt, bigIntTo32Bytes };
