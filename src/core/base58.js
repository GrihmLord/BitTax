/**
 * base58.js
 * Bitcoin Base58 and Base58Check encoding.
 *
 * The alphabet deliberately omits 0, O, I and l so that a mistyped key is far
 * more likely to fail the checksum than to decode into a different valid key.
 */

import { sha256d } from './sha256.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = 58n;

const INDEX = new Map();
for (let i = 0; i < ALPHABET.length; i += 1) INDEX.set(ALPHABET[i], BigInt(i));

/** Characters that look like a valid Base58 character but are not, for better error messages. */
const CONFUSABLES = Object.freeze({ 0: 'O', O: '0', I: '1', l: '1' });

/**
 * @param {string} text
 * @returns {Uint8Array}
 * @throws {TypeError} on any character outside the alphabet
 */
export const base58Decode = (text) => {
    if (typeof text !== 'string' || text.length === 0) throw new TypeError('Base58 input is empty');

    let value = 0n;
    for (const char of text) {
        const digit = INDEX.get(char);
        if (digit === undefined) {
            const hint = CONFUSABLES[char] ? ` (did you mean "${CONFUSABLES[char]}"?)` : '';
            throw new TypeError(`Invalid Base58 character "${char}"${hint}`);
        }
        value = value * BASE + digit;
    }

    const digits = [];
    while (value > 0n) {
        digits.push(Number(value % 256n));
        value /= 256n;
    }
    digits.reverse();

    // Each leading '1' encodes one leading zero byte.
    let leadingZeros = 0;
    while (leadingZeros < text.length && text[leadingZeros] === ALPHABET[0]) leadingZeros += 1;

    const out = new Uint8Array(leadingZeros + digits.length);
    out.set(digits, leadingZeros);
    return out;
};

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export const base58Encode = (bytes) => {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('base58Encode requires a Uint8Array');

    let value = 0n;
    for (const byte of bytes) value = value * 256n + BigInt(byte);

    let out = '';
    while (value > 0n) {
        out = ALPHABET[Number(value % BASE)] + out;
        value /= BASE;
    }

    let leadingZeros = 0;
    while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;

    return ALPHABET[0].repeat(leadingZeros) + out;
};

const bytesEqual = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Decodes and verifies the trailing 4 byte double-SHA256 checksum.
 *
 * @param {string} text
 * @returns {Uint8Array} the payload with the checksum stripped
 * @throws {Error} when the checksum does not match
 */
export const base58CheckDecode = (text) => {
    const decoded = base58Decode(text);
    if (decoded.length < 5) throw new TypeError('Base58Check payload is too short');

    const payload = decoded.subarray(0, decoded.length - 4);
    const checksum = decoded.subarray(decoded.length - 4);
    const expected = sha256d(payload).subarray(0, 4);

    if (!bytesEqual(checksum, expected)) {
        throw new Error('Checksum mismatch — the key is mistyped, truncated, or corrupted');
    }
    return payload;
};

/**
 * @param {Uint8Array} payload
 * @returns {string}
 */
export const base58CheckEncode = (payload) => {
    const checksum = sha256d(payload).subarray(0, 4);
    const combined = new Uint8Array(payload.length + 4);
    combined.set(payload);
    combined.set(checksum, payload.length);
    return base58Encode(combined);
};

export { ALPHABET as BASE58_ALPHABET };
