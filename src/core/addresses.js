/**
 * addresses.js
 * Turns a compressed public key into an address, for each script type BitTax
 * recognises in an extended key.
 *
 * `hash160` (RIPEMD160 of SHA256) is injected rather than implemented here, so
 * the core stays dependency-free and the caller supplies whichever
 * implementation its runtime has — `node:crypto` in the desktop main process.
 */

import { base58CheckEncode } from './base58.js';
import { encodeSegwitAddress } from './bech32.js';

/** Address version bytes and bech32 prefixes, per network. */
export const NETWORKS = Object.freeze({
    mainnet: Object.freeze({ p2pkhVersion: 0x00, p2shVersion: 0x05, hrp: 'bc' }),
    testnet: Object.freeze({ p2pkhVersion: 0x6f, p2shVersion: 0xc4, hrp: 'tb' }),
});

/** Script types a single extended key can produce addresses for on its own. */
export const SINGLE_SIG_SCRIPTS = Object.freeze(['P2PKH', 'P2SH-P2WPKH', 'P2WPKH']);

const withVersion = (version, payload) => {
    const out = new Uint8Array(payload.length + 1);
    out[0] = version;
    out.set(payload, 1);
    return out;
};

/**
 * The redeem script wrapped by a P2SH-P2WPKH address:
 * OP_0 (0x00), a 20-byte push (0x14), then the key hash.
 */
const witnessRedeemScript = (keyHash) => {
    const script = new Uint8Array(22);
    script[0] = 0x00;
    script[1] = 0x14;
    script.set(keyHash, 2);
    return script;
};

/**
 * @param {Uint8Array} publicKey - 33-byte compressed SEC key
 * @param {object} options
 * @param {string} options.script - one of SINGLE_SIG_SCRIPTS
 * @param {string} options.network - 'mainnet' or 'testnet'
 * @param {(bytes: Uint8Array) => Uint8Array} options.hash160 - RIPEMD160(SHA256(x))
 * @returns {string} the address
 */
export const addressFromPublicKey = (publicKey, { script, network, hash160 }) => {
    if (!(publicKey instanceof Uint8Array) || publicKey.length !== 33) {
        throw new TypeError('An address is derived from a 33-byte compressed public key');
    }
    if (typeof hash160 !== 'function') throw new TypeError('addressFromPublicKey needs a hash160 implementation');

    const params = NETWORKS[network];
    if (!params) throw new RangeError(`Unknown network "${network}"`);

    const keyHash = hash160(publicKey);
    if (!(keyHash instanceof Uint8Array) || keyHash.length !== 20) {
        throw new TypeError('hash160 must return 20 bytes');
    }

    switch (script) {
        case 'P2PKH':
            return base58CheckEncode(withVersion(params.p2pkhVersion, keyHash));

        case 'P2SH-P2WPKH':
            // The address commits to the redeem script, not to the key hash directly.
            return base58CheckEncode(withVersion(params.p2shVersion, hash160(witnessRedeemScript(keyHash))));

        case 'P2WPKH':
            return encodeSegwitAddress(params.hrp, 0, keyHash);

        default:
            throw new RangeError(
                `Cannot derive a single-signature address for script type "${script}". `
                + `Supported: ${SINGLE_SIG_SCRIPTS.join(', ')}. `
                + 'Multisig keys (Ypub/Zpub) need every cosigner\'s key to produce an address.',
            );
    }
};

export { witnessRedeemScript };
