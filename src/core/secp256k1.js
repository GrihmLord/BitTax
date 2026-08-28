/**
 * secp256k1.js
 * Affine point arithmetic over the Bitcoin curve, in BigInt.
 *
 * Only what BIP32 public derivation needs: decompress a public key, add points,
 * multiply the generator by a scalar, compress the result. There is no private
 * key handling here and no signing — BitTax is watch-only, so the operations
 * that could move funds are simply absent.
 *
 * The curve is y^2 = x^3 + 7 over F_p, so a = 0 and the doubling formula drops
 * a term. Coordinates are affine, which costs one modular inverse per point
 * operation. Jacobian coordinates would be several times faster, but this runs
 * a few dozen times when a user asks for a gap-limit scan, not in a loop, and
 * the simpler formulas are much easier to verify by eye.
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

/** Scalar multiplication by double-and-add. */
export const scalarMultiply = (scalar, point = G) => {
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
