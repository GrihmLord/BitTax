/**
 * secrets.js
 * Screens user input for spending material before anything else touches it.
 *
 * An audit tool only ever needs watch-only keys. If someone pastes an xprv, a
 * WIF private key or a seed phrase into the key box, the correct response is
 * to refuse the input, keep it out of state, logs and persistence, and say
 * plainly that the material should now be considered compromised.
 */

export const SECRET_KIND = Object.freeze({
    EXTENDED_PRIVATE_KEY: 'EXTENDED_PRIVATE_KEY',
    WIF_PRIVATE_KEY: 'WIF_PRIVATE_KEY',
    RAW_PRIVATE_KEY: 'RAW_PRIVATE_KEY',
    MNEMONIC: 'MNEMONIC',
});

/** SLIP-132 private key prefixes across mainnet and testnet. */
const EXTENDED_PRIVATE_PREFIXES = ['xprv', 'yprv', 'zprv', 'Yprv', 'Zprv', 'tprv', 'uprv', 'vprv', 'Uprv', 'Vprv'];

const WIF_UNCOMPRESSED = /^5[HJK][1-9A-HJ-NP-Za-km-z]{49}$/;
const WIF_COMPRESSED = /^[KL][1-9A-HJ-NP-Za-km-z]{51}$/;
const WIF_TESTNET = /^[9c][1-9A-HJ-NP-Za-km-z]{50}$/;
const RAW_HEX_KEY = /^(0x)?[0-9a-fA-F]{64}$/;
const MNEMONIC_WORD = /^[a-z]{3,8}$/;

/** BIP39 mnemonics are only ever these lengths. */
const MNEMONIC_LENGTHS = new Set([12, 15, 18, 21, 24]);

const looksLikeMnemonic = (text) => {
    const words = text.trim().split(/\s+/);
    if (!MNEMONIC_LENGTHS.has(words.length)) return false;
    return words.every((word) => MNEMONIC_WORD.test(word));
};

const MESSAGES = Object.freeze({
    [SECRET_KIND.EXTENDED_PRIVATE_KEY]:
        'That is an extended PRIVATE key (xprv/yprv/zprv). It can spend your funds. '
        + 'BitTax only ever needs the matching public key (xpub/ypub/zpub).',
    [SECRET_KIND.WIF_PRIVATE_KEY]:
        'That is a WIF private key. It can spend the funds at its address. BitTax never needs a private key.',
    [SECRET_KIND.RAW_PRIVATE_KEY]:
        'That looks like a raw 256-bit private key. BitTax never needs a private key.',
    [SECRET_KIND.MNEMONIC]:
        'That looks like a BIP39 seed phrase. It controls every key in the wallet. BitTax never needs a seed phrase.',
});

/**
 * Classifies input that must never be accepted.
 *
 * @param {string} input
 * @returns {{kind: string, message: string}|null} null when the input carries no spending authority
 */
export const detectSecretMaterial = (input) => {
    const text = String(input == null ? '' : input).trim();
    if (text === '') return null;

    const compact = text.replace(/\s+/g, '');

    const kind = classify(text, compact);
    if (!kind) return null;

    return {
        kind,
        message: `${MESSAGES[kind]} Treat it as compromised: move the funds to a new wallet created on an offline device.`,
    };
};

const classify = (text, compact) => {
    if (EXTENDED_PRIVATE_PREFIXES.some((prefix) => compact.startsWith(prefix))) {
        return SECRET_KIND.EXTENDED_PRIVATE_KEY;
    }
    if (WIF_UNCOMPRESSED.test(compact) || WIF_COMPRESSED.test(compact) || WIF_TESTNET.test(compact)) {
        return SECRET_KIND.WIF_PRIVATE_KEY;
    }
    if (RAW_HEX_KEY.test(compact)) return SECRET_KIND.RAW_PRIVATE_KEY;
    if (looksLikeMnemonic(text)) return SECRET_KIND.MNEMONIC;
    return null;
};

/**
 * Throws if the input carries spending authority. Call this at every boundary
 * where user text enters the application.
 *
 * @param {string} input
 * @throws {Error} tagged with `kind` so the UI can style the warning
 */
export const assertNoSecretMaterial = (input) => {
    const found = detectSecretMaterial(input);
    if (!found) return;
    const error = new Error(found.message);
    error.name = 'SecretMaterialError';
    error.kind = found.kind;
    throw error;
};
