/**
 * xpub.js
 * Real BIP32 / SLIP-132 extended public key parsing.
 *
 * This replaces a prefix check (`startsWith('xpub')`) that accepted any
 * mistyped or fabricated string. A key is now decoded, checksummed and
 * structurally validated before the application will hold it.
 */

import { base58CheckDecode } from './base58.js';
import { bytesToHex } from './sha256.js';
import { assertNoSecretMaterial } from './secrets.js';
import { deriveAddressRange } from './bip32.js';
import { addressFromPublicKey, SINGLE_SIG_SCRIPTS } from './addresses.js';

const SERIALIZED_LENGTH = 78;

/**
 * SLIP-132 version bytes. `script` is the output type the key's addresses use,
 * which is what determines the derivation path a wallet would have used.
 */
const VERSIONS = Object.freeze({
    0x0488b21e: { prefix: 'xpub', network: 'mainnet', script: 'P2PKH', purpose: 44, label: 'Legacy' },
    0x049d7cb2: { prefix: 'ypub', network: 'mainnet', script: 'P2SH-P2WPKH', purpose: 49, label: 'Nested SegWit' },
    0x04b24746: { prefix: 'zpub', network: 'mainnet', script: 'P2WPKH', purpose: 84, label: 'Native SegWit' },
    0x0295b43f: { prefix: 'Ypub', network: 'mainnet', script: 'P2SH-P2WSH', purpose: 48, label: 'Nested SegWit multisig' },
    0x02aa7ed3: { prefix: 'Zpub', network: 'mainnet', script: 'P2WSH', purpose: 48, label: 'Native SegWit multisig' },
    0x043587cf: { prefix: 'tpub', network: 'testnet', script: 'P2PKH', purpose: 44, label: 'Legacy (testnet)' },
    0x044a5262: { prefix: 'upub', network: 'testnet', script: 'P2SH-P2WPKH', purpose: 49, label: 'Nested SegWit (testnet)' },
    0x045f1cf6: { prefix: 'vpub', network: 'testnet', script: 'P2WPKH', purpose: 84, label: 'Native SegWit (testnet)' },
    0x024289ef: { prefix: 'Upub', network: 'testnet', script: 'P2SH-P2WSH', purpose: 48, label: 'Nested SegWit multisig (testnet)' },
    0x02575483: { prefix: 'Vpub', network: 'testnet', script: 'P2WSH', purpose: 48, label: 'Native SegWit multisig (testnet)' },
});

export const SUPPORTED_XPUB_PREFIXES = Object.freeze(
    Object.values(VERSIONS).filter((v) => v.network === 'mainnet').map((v) => v.prefix),
);

const readUint32BE = (bytes, offset) =>
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

const fail = (message) => {
    const error = new Error(message);
    error.name = 'InvalidExtendedKeyError';
    throw error;
};

/**
 * Validates the 33 byte key field. A leading 0x00 means the caller handed us a
 * serialized *private* key wearing a public version prefix.
 */
const assertPublicKeyField = (keyData) => {
    if (keyData[0] === 0x00) {
        const error = new Error(
            'This key contains PRIVATE key material despite its public prefix. '
            + 'Treat it as compromised and move the funds to a new wallet.',
        );
        error.name = 'SecretMaterialError';
        throw error;
    }
    if (keyData[0] !== 0x02 && keyData[0] !== 0x03) {
        fail(`Malformed public key: expected a compressed point prefix of 0x02 or 0x03, found 0x${keyData[0].toString(16).padStart(2, '0')}`);
    }
};

/**
 * BIP32 requires a master key (depth 0) to carry no parent fingerprint and no
 * child index. A mismatch means the key was assembled by hand or corrupted.
 */
const assertDepthConsistency = (depth, parentFingerprint, childNumber) => {
    if (depth !== 0) return;
    if (parentFingerprint !== 0) fail('Depth is 0 but a parent fingerprint is set — the key is inconsistent');
    if (childNumber !== 0) fail('Depth is 0 but a child index is set — the key is inconsistent');
};

/**
 * Parses and fully validates an extended public key.
 *
 * @param {string} input
 * @returns {{
 *   prefix:string, network:string, script:string, purpose:number, label:string,
 *   depth:number, parentFingerprint:string, childNumber:number, chainCode:string,
 *   publicKey:string, normalised:string
 * }}
 * @throws {Error} named `SecretMaterialError` or `InvalidExtendedKeyError`
 */
export const parseExtendedPublicKey = (input) => {
    assertNoSecretMaterial(input);

    const text = String(input == null ? '' : input).trim().replace(/\s+/g, '');
    if (text === '') fail('No key supplied');

    let payload;
    try {
        payload = base58CheckDecode(text);
    } catch (error) {
        fail(`Not a valid extended key: ${error.message}`);
    }

    if (payload.length !== SERIALIZED_LENGTH) {
        fail(`Extended keys are ${SERIALIZED_LENGTH} bytes; this decoded to ${payload.length}`);
    }

    const version = readUint32BE(payload, 0);
    const descriptor = VERSIONS[version];
    if (!descriptor) {
        fail(`Unrecognised version bytes 0x${version.toString(16).padStart(8, '0')}. `
            + `Supported: ${SUPPORTED_XPUB_PREFIXES.join(', ')}`);
    }

    const depth = payload[4];
    const parentFingerprint = readUint32BE(payload, 5);
    const childNumber = readUint32BE(payload, 9);
    const keyData = payload.subarray(45, 78);

    assertPublicKeyField(keyData);
    assertDepthConsistency(depth, parentFingerprint, childNumber);

    return {
        ...descriptor,
        depth,
        parentFingerprint: parentFingerprint.toString(16).padStart(8, '0'),
        childNumber,
        chainCode: bytesToHex(payload.subarray(13, 45)),
        publicKey: bytesToHex(keyData),
        normalised: text,
    };
};

/** True when the input is a structurally valid extended public key. */
export const isValidExtendedPublicKey = (input) => {
    try {
        parseExtendedPublicKey(input);
        return true;
    } catch {
        return false;
    }
};

/**
 * Renders a key for display without showing enough of it to be reconstructed
 * or to identify the wallet in a screenshot or support ticket.
 */
export const maskExtendedKey = (input) => {
    const text = String(input == null ? '' : input).trim();
    if (text.length <= 12) return '•'.repeat(text.length);
    return `${text.slice(0, 8)}…${text.slice(-4)}`;
};

/**
 * Expands an extended public key into addresses.
 *
 * The two hash functions are injected because BIP32 needs HMAC-SHA512 and
 * addresses need RIPEMD160, neither of which belongs in a dependency-free core.
 * The desktop app supplies them from `node:crypto` via `src/main/derive.mjs`,
 * which also gates every call behind a self-test.
 *
 * Calling this without them throws rather than guessing — the previous
 * implementation returned two hardcoded placeholder addresses that were
 * indistinguishable from real output.
 *
 * @param {string} input - the extended public key
 * @param {object} deps
 * @param {(key: Uint8Array, data: Uint8Array) => Uint8Array} deps.hmacSha512
 * @param {(bytes: Uint8Array) => Uint8Array} deps.hash160
 * @param {number} [deps.chain=0] - 0 external, 1 internal (change)
 * @param {number} [deps.start=0]
 * @param {number} [deps.count=20]
 * @returns {Array<{index:number, path:string, publicKey:string, address:string}>}
 */
export const deriveAddressesFromXpub = (input, deps = {}) => {
    const parsed = parseExtendedPublicKey(input);
    const { hmacSha512, hash160, chain = 0, start = 0, count = 20 } = deps;

    if (typeof hmacSha512 !== 'function' || typeof hash160 !== 'function') {
        const error = new Error(
            `The key is valid (${parsed.label}, BIP${parsed.purpose}), but deriving addresses needs `
            + 'HMAC-SHA512 and RIPEMD160 implementations passed in as { hmacSha512, hash160 }. '
            + 'In the desktop app this happens in the main process; see src/main/derive.mjs.',
        );
        error.name = 'MissingCryptoDependencyError';
        error.keyInfo = parsed;
        throw error;
    }

    if (!SINGLE_SIG_SCRIPTS.includes(parsed.script)) {
        const error = new RangeError(
            `${parsed.prefix} keys describe ${parsed.script} multisig outputs, which need every `
            + 'cosigner\'s key before an address exists.',
        );
        error.name = 'UnsupportedScriptError';
        throw error;
    }

    return deriveAddressRange(parsed, {
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
};
