/**
 * bip32.js
 * Public (non-hardened) child key derivation — BIP32 CKDpub.
 *
 * Given an extended PUBLIC key this walks down the tree. Hardened indices are
 * impossible here by design: they require the parent private key, which BitTax
 * never has and never wants. An account-level xpub is exactly the right thing
 * to hand a watch-only auditor, and the receive and change chains hang directly
 * off it as indices 0 and 1.
 *
 * HMAC-SHA512 is injected so this module has no dependencies of its own; the
 * desktop main process supplies `node:crypto`.
 */

import { N, G, decompressPoint, compressPoint, pointAdd, scalarMultiply, bytesToBigInt, INFINITY } from './secp256k1.js';

/** Indices at or above this are hardened, and unreachable from a public key. */
export const HARDENED_OFFSET = 0x80000000;

/** BIP44 chain indices: external addresses are handed out, internal take change. */
export const CHAIN = Object.freeze({ EXTERNAL: 0, INTERNAL: 1 });

const ser32 = (index) => Uint8Array.from([
    (index >>> 24) & 0xff,
    (index >>> 16) & 0xff,
    (index >>> 8) & 0xff,
    index & 0xff,
]);

const concat = (a, b) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
};

const hexToBytes = (hex) => {
    const clean = String(hex).trim();
    if (clean.length % 2 !== 0) throw new TypeError('Hex string has an odd length');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(byte)) throw new TypeError(`Invalid hex in "${clean}"`);
        out[i] = byte;
    }
    return out;
};

/**
 * Derives one non-hardened child of an extended public key.
 *
 * I = HMAC-SHA512(chainCode, serP(K_par) || ser32(i))
 * K_i = point(I_L) + K_par,  c_i = I_R
 *
 * @param {{publicKey: Uint8Array, chainCode: Uint8Array, depth: number}} parent
 * @param {number} index - must be below HARDENED_OFFSET
 * @param {(key: Uint8Array, data: Uint8Array) => Uint8Array} hmacSha512
 * @returns {{publicKey: Uint8Array, chainCode: Uint8Array, depth: number, index: number}}
 */
export const deriveChild = (parent, index, hmacSha512) => {
    if (!Number.isInteger(index) || index < 0) throw new RangeError(`Child index must be a non-negative integer, got ${index}`);
    if (index >= HARDENED_OFFSET) {
        throw new RangeError(
            `Index ${index - HARDENED_OFFSET}' is hardened and cannot be derived from a public key. `
            + 'Export the account-level extended public key from your wallet instead.',
        );
    }
    if (typeof hmacSha512 !== 'function') throw new TypeError('deriveChild needs an HMAC-SHA512 implementation');

    const digest = hmacSha512(parent.chainCode, concat(parent.publicKey, ser32(index)));
    if (!(digest instanceof Uint8Array) || digest.length !== 64) {
        throw new TypeError('HMAC-SHA512 must return 64 bytes');
    }

    const tweak = bytesToBigInt(digest.subarray(0, 32));
    const chainCode = digest.subarray(32, 64);

    // BIP32: if I_L is not a valid scalar, or the sum is the point at infinity,
    // this index is invalid and the caller should move to the next one. The
    // probability is around 1 in 2^127, so it is reported rather than retried
    // silently — a hit almost certainly means something else is wrong.
    if (tweak === 0n || tweak >= N) {
        throw new RangeError(`Child index ${index} produced an invalid scalar; try the next index`);
    }

    const point = pointAdd(scalarMultiply(tweak, G), decompressPoint(parent.publicKey));
    if (point === INFINITY) {
        throw new RangeError(`Child index ${index} produced the point at infinity; try the next index`);
    }

    return {
        publicKey: compressPoint(point),
        chainCode: new Uint8Array(chainCode),
        depth: parent.depth + 1,
        index,
    };
};

/**
 * Walks a relative path of non-hardened indices from a parsed extended key.
 *
 * @param {{publicKey: string, chainCode: string, depth: number}} parsed - from parseExtendedPublicKey
 * @param {Array<number>} path
 * @param {Function} hmacSha512
 */
export const derivePath = (parsed, path, hmacSha512) => {
    let node = {
        publicKey: hexToBytes(parsed.publicKey),
        chainCode: hexToBytes(parsed.chainCode),
        depth: parsed.depth,
    };
    for (const index of path) node = deriveChild(node, index, hmacSha512);
    return node;
};

/**
 * Derives a run of addresses on one chain of an account-level extended key.
 *
 * The chain node is derived once and each address is then one child of it,
 * rather than re-walking from the account for every index.
 *
 * @param {object} parsed - from parseExtendedPublicKey
 * @param {object} options
 * @param {number} [options.chain=0] - 0 external, 1 internal (change)
 * @param {number} [options.start=0]
 * @param {number} [options.count=20]
 * @param {Function} options.hmacSha512
 * @param {(publicKey: Uint8Array) => string} options.toAddress
 * @returns {Array<{index: number, path: string, publicKey: string, address: string}>}
 */
export const deriveAddressRange = (parsed, {
    chain = CHAIN.EXTERNAL, start = 0, count = 20, hmacSha512, toAddress,
}) => {
    if (!Number.isInteger(start) || start < 0) throw new RangeError('start must be a non-negative integer');
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
    if (typeof toAddress !== 'function') throw new TypeError('deriveAddressRange needs a toAddress function');

    const chainNode = derivePath(parsed, [chain], hmacSha512);
    const results = [];

    for (let offset = 0; offset < count; offset += 1) {
        const index = start + offset;
        if (index >= HARDENED_OFFSET) break;

        const child = deriveChild(chainNode, index, hmacSha512);
        results.push({
            index,
            path: `m/${chain}/${index}`,
            publicKey: Array.from(child.publicKey, (b) => b.toString(16).padStart(2, '0')).join(''),
            address: toAddress(child.publicKey),
        });
    }

    return results;
};

export { ser32, hexToBytes };
