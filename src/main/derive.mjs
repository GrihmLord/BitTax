/**
 * derive.mjs  (main process only)
 * Address derivation from a watch-only extended public key.
 *
 * WHY THIS LIVES IN THE MAIN PROCESS
 * BIP32 needs HMAC-SHA512, and addresses need RIPEMD160. Both come from
 * `node:crypto` here rather than being hand-written, which removes the two
 * largest sources of error — the SHA-512 round constants and the RIPEMD-160
 * word-order and rotation tables — from code we would otherwise have to get
 * exactly right. What remains in `src/core` is elliptic curve arithmetic and
 * bech32, both of which verify themselves.
 *
 * FAIL-CLOSED
 * Nothing derives until `ensureReady()` has confirmed the curve arithmetic,
 * the bech32 encoder, Base58Check, and an end-to-end BIP32 CKDpub vector. If
 * any check fails, every derivation call throws and names the failing check.
 * Showing a wrong address to someone auditing their own cold storage is far
 * worse than showing none, so a broken build must refuse rather than guess.
 */

import { createHash, createHmac, getHashes } from 'node:crypto';

import { selfTest as curveSelfTest } from '../core/secp256k1.js';
import { selfTest as bech32SelfTest } from '../core/bech32.js';
import { parseExtendedPublicKey } from '../core/xpub.js';
import { base58CheckDecode, base58CheckEncode } from '../core/base58.js';
import { deriveAddressRange, derivePath, CHAIN } from '../core/bip32.js';
import { addressFromPublicKey, SINGLE_SIG_SCRIPTS } from '../core/addresses.js';

/** Upper bound on a single scan. Each address costs a scalar multiplication. */
export const MAX_ADDRESSES = 200;

const toBytes = (value) => (Buffer.isBuffer(value) ? new Uint8Array(value) : value);

/** HMAC-SHA512, as BIP32 specifies for the child derivation function. */
const hmacSha512 = (key, data) => toBytes(createHmac('sha512', Buffer.from(key)).update(Buffer.from(data)).digest());

/**
 * RIPEMD160(SHA256(x)).
 *
 * RIPEMD-160 is a legacy digest in OpenSSL 3 and is absent from some Node
 * builds. That is detected up front so the failure is a clear message rather
 * than an exception from deep inside address encoding.
 */
const ripemd160Available = () => getHashes().includes('ripemd160');

const hash160 = (bytes) => {
    const sha = createHash('sha256').update(Buffer.from(bytes)).digest();
    return toBytes(createHash('ripemd160').update(sha).digest());
};

/**
 * BIP32 Test Vector 1, seed 000102030405060708090a0b0c0d0e0f.
 *
 * Deriving index 1 from the chain m/0H must reproduce m/0H/1 exactly. This is
 * the whole CKDpub path — HMAC, scalar multiplication, point addition and
 * compression — checked end to end against published values, using only public
 * keys.
 *
 * If this check fails while the curve and encoding checks pass, suspect these
 * two constants before suspecting the algorithm: verify them against the test
 * vectors in BIP32 and correct them here.
 */
const BIP32_VECTOR = Object.freeze({
    parent: 'xpub68Gmy5EdvgibQVfPdqkBBCHxA5htiqg55crXYuXoQRKfDBFA1WEjWgP6LHhwBZeNK1VTsfTFUHCdrfp1bgwQ9xv5ski8PX9rL2dZXvgGDnw',
    index: 1,
    child: 'xpub6ASuArnXKPbfEwhqN6e3mwBcDTgzisQN1wXN9BJcM47sSikHjJf3UFHKkNAWbWMiGj7Wf5uMash7SyYq527Hqck2AxYysAA7xmALppuCkwQ',
});

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Checks Base58Check against the genesis coinbase address. */
const base58Check = () => {
    const genesis = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    try {
        return base58CheckEncode(base58CheckDecode(genesis)) === genesis;
    } catch {
        return false;
    }
};

/** Checks CKDpub end to end against the BIP32 vector. */
const ckdPub = () => {
    try {
        const parent = parseExtendedPublicKey(BIP32_VECTOR.parent);
        const expected = parseExtendedPublicKey(BIP32_VECTOR.child);
        const derived = derivePath(parent, [BIP32_VECTOR.index], hmacSha512);

        return hex(derived.publicKey) === expected.publicKey
            && hex(derived.chainCode) === expected.chainCode;
    } catch {
        return false;
    }
};

let cachedReport = null;

/**
 * Runs every check once and caches the verdict.
 * @returns {{ok: boolean, failures: Array<string>}}
 */
export const runSelfTest = () => {
    if (cachedReport) return cachedReport;

    const failures = [];

    if (!ripemd160Available()) {
        failures.push('node:crypto does not provide ripemd160 in this build, so addresses cannot be hashed');
    }

    const curve = curveSelfTest();
    failures.push(...curve.failures.map((name) => `secp256k1: ${name}`));

    const bech = bech32SelfTest();
    failures.push(...bech.failures.map((name) => `bech32: ${name}`));

    if (!base58Check()) failures.push('base58check: the genesis address does not round-trip');
    if (!ckdPub()) failures.push('bip32: CKDpub does not reproduce BIP32 test vector 1 (m/0H -> m/0H/1)');

    cachedReport = { ok: failures.length === 0, failures };
    return cachedReport;
};

/**
 * Throws unless every check passed.
 * @throws {Error} named `DerivationUnavailableError`
 */
export const ensureReady = () => {
    const report = runSelfTest();
    if (report.ok) return;

    const error = new Error(
        'Address derivation is disabled because its self-test failed, so BitTax will not show you '
        + `addresses it cannot vouch for. Failing checks: ${report.failures.join('; ')}.`,
    );
    error.name = 'DerivationUnavailableError';
    error.failures = report.failures;
    throw error;
};

/**
 * Derives a run of addresses from an account-level extended public key.
 *
 * @param {string} extendedKey
 * @param {{chain?: number, start?: number, count?: number}} [options]
 * @returns {{key: object, chain: number, addresses: Array<object>}}
 */
export const deriveAddresses = (extendedKey, options = {}) => {
    ensureReady();

    const parsed = parseExtendedPublicKey(extendedKey);
    if (!SINGLE_SIG_SCRIPTS.includes(parsed.script)) {
        throw new RangeError(
            `${parsed.prefix} keys describe ${parsed.script} multisig outputs. `
            + 'An address needs every cosigner\'s key, so it cannot be derived from this one alone.',
        );
    }

    const chain = options.chain === CHAIN.INTERNAL ? CHAIN.INTERNAL : CHAIN.EXTERNAL;
    const start = Number.isInteger(options.start) ? options.start : 0;
    const count = Math.min(Number.isInteger(options.count) ? options.count : 20, MAX_ADDRESSES);

    const addresses = deriveAddressRange(parsed, {
        chain,
        start,
        count,
        hmacSha512,
        toAddress: (publicKey) => addressFromPublicKey(publicKey, {
            script: parsed.script,
            network: parsed.network,
            hash160,
        }),
    });

    return {
        key: {
            prefix: parsed.prefix,
            script: parsed.script,
            network: parsed.network,
            purpose: parsed.purpose,
            depth: parsed.depth,
        },
        chain,
        addresses,
    };
};

export { hmacSha512, hash160, BIP32_VECTOR };
