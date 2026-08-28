/**
 * bech32.js
 * BIP173 bech32 and BIP350 bech32m, for SegWit address encoding.
 *
 * The checksum is the reason this exists: bech32 is designed so that a small
 * number of typos in an address are always detected. Encoding an address by
 * concatenating strings would throw that guarantee away.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** Checksum constant for witness version 0 (BIP173). */
export const BECH32_CONST = 1;
/** Checksum constant for witness versions 1 and above (BIP350). */
export const BECH32M_CONST = 0x2bc830a3;

const CHARSET_INDEX = new Map();
for (let i = 0; i < CHARSET.length; i += 1) CHARSET_INDEX.set(CHARSET[i], i);

/** The BCH code over GF(32) that produces the checksum. */
const polymod = (values) => {
    let chk = 1;
    for (const value of values) {
        const top = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ value;
        for (let i = 0; i < 5; i += 1) {
            if ((top >>> i) & 1) chk ^= GENERATOR[i];
        }
    }
    return chk >>> 0;
};

/** The human readable part enters the checksum as high bits, a separator, then low bits. */
const hrpExpand = (hrp) => {
    const high = [];
    const low = [];
    for (const char of hrp) {
        const code = char.codePointAt(0);
        high.push(code >>> 5);
        low.push(code & 31);
    }
    return [...high, 0, ...low];
};

const createChecksum = (hrp, data, constant) => {
    const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
    const mod = polymod(values) ^ constant;
    return Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
};

/**
 * Repacks a byte stream between bit widths — 8-bit bytes to the 5-bit groups
 * bech32 encodes, or back again.
 *
 * @param {Iterable<number>} values
 * @param {number} from - source bit width
 * @param {number} to - target bit width
 * @param {boolean} pad - pad the final group (true when encoding)
 * @returns {Array<number>}
 */
export const convertBits = (values, from, to, pad) => {
    let acc = 0;
    let bits = 0;
    const out = [];
    const maxValue = (1 << to) - 1;
    const maxAcc = (1 << (from + to - 1)) - 1;

    for (const value of values) {
        if (value < 0 || value >>> from !== 0) throw new RangeError(`Value ${value} does not fit in ${from} bits`);
        acc = ((acc << from) | value) & maxAcc;
        bits += from;
        while (bits >= to) {
            bits -= to;
            out.push((acc >>> bits) & maxValue);
        }
    }

    if (pad) {
        if (bits > 0) out.push((acc << (to - bits)) & maxValue);
    } else if (bits >= from || ((acc << (to - bits)) & maxValue)) {
        throw new RangeError('Invalid padding in bit conversion');
    }

    return out;
};

/**
 * @param {string} hrp - human readable part, e.g. "bc"
 * @param {Array<number>} data - 5-bit groups
 * @param {number} constant - BECH32_CONST or BECH32M_CONST
 * @returns {string}
 */
export const bech32Encode = (hrp, data, constant = BECH32_CONST) => {
    if (!hrp) throw new TypeError('bech32 requires a human readable part');

    const combined = [...data, ...createChecksum(hrp, data, constant)];
    const encoded = combined.map((value) => {
        if (value < 0 || value > 31) throw new RangeError(`Data value ${value} is out of range`);
        return CHARSET[value];
    }).join('');

    const address = `${hrp}1${encoded}`;
    if (address.length > 90) throw new RangeError('bech32 strings are limited to 90 characters');
    return address;
};

/**
 * Encodes a SegWit output as an address.
 *
 * Version 0 uses the original bech32 checksum; every later version uses
 * bech32m. Mixing them up produces an address that wallets reject, so the
 * constant is chosen here rather than left to the caller.
 *
 * @param {string} hrp - "bc" mainnet, "tb" testnet, "bcrt" regtest
 * @param {number} version - witness version, 0 to 16
 * @param {Uint8Array} program - witness program, 2 to 40 bytes
 * @returns {string}
 */
export const encodeSegwitAddress = (hrp, version, program) => {
    if (!Number.isInteger(version) || version < 0 || version > 16) {
        throw new RangeError(`Witness version must be 0 to 16, got ${version}`);
    }
    if (!(program instanceof Uint8Array)) throw new TypeError('Witness program must be a Uint8Array');
    if (program.length < 2 || program.length > 40) {
        throw new RangeError(`Witness program must be 2 to 40 bytes, got ${program.length}`);
    }
    if (version === 0 && program.length !== 20 && program.length !== 32) {
        throw new RangeError('A version 0 witness program must be 20 bytes (P2WPKH) or 32 bytes (P2WSH)');
    }

    const data = [version, ...convertBits(program, 8, 5, true)];
    return bech32Encode(hrp, data, version === 0 ? BECH32_CONST : BECH32M_CONST);
};

/**
 * Decodes a bech32 string and verifies its checksum.
 * Used by the self-test to prove encoding round-trips.
 *
 * @returns {{hrp: string, data: Array<number>, constant: number}}
 */
export const bech32Decode = (address) => {
    const text = String(address || '');
    const hasUpper = /[A-Z]/.test(text);
    const hasLower = /[a-z]/.test(text);
    if (hasUpper && hasLower) throw new RangeError('bech32 strings must not mix cases');

    const normalised = text.toLowerCase();
    const separator = normalised.lastIndexOf('1');
    if (separator < 1 || separator + 7 > normalised.length) throw new RangeError('Malformed bech32 string');

    const hrp = normalised.slice(0, separator);
    const data = [];
    for (const char of normalised.slice(separator + 1)) {
        const value = CHARSET_INDEX.get(char);
        if (value === undefined) throw new RangeError(`Invalid bech32 character "${char}"`);
        data.push(value);
    }

    const checksum = polymod([...hrpExpand(hrp), ...data]);
    if (checksum !== BECH32_CONST && checksum !== BECH32M_CONST) {
        throw new RangeError('bech32 checksum does not verify');
    }

    return { hrp, data: data.slice(0, -6), constant: checksum };
};

/**
 * Checks encoding against the canonical BIP173 vector, and that the encoder and
 * decoder agree.
 *
 * @returns {{ok: boolean, failures: Array<string>}}
 */
export const selfTest = () => {
    const failures = [];
    const check = (name, condition) => { if (!condition) failures.push(name); };

    // BIP173 test vector: the witness program below encodes to this P2WPKH address.
    const program = Uint8Array.from([
        0x75, 0x1e, 0x76, 0xe8, 0x19, 0x91, 0x96, 0xd4, 0x54, 0x94,
        0x1c, 0x45, 0xd1, 0xb3, 0xa3, 0x23, 0xf1, 0x43, 0x3b, 0xd6,
    ]);
    const expected = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    let encoded = null;
    try {
        encoded = encodeSegwitAddress('bc', 0, program);
    } catch {
        encoded = null;
    }
    check('BIP173 P2WPKH vector encodes correctly', encoded === expected);

    try {
        const { hrp, data } = bech32Decode(expected);
        const recovered = Uint8Array.from(convertBits(data.slice(1), 5, 8, false));
        check('decoded human readable part is bc', hrp === 'bc');
        check('witness program round-trips', recovered.length === 20 && recovered.every((b, i) => b === program[i]));
    } catch {
        failures.push('BIP173 vector fails to decode');
    }

    let rejectedBadChecksum = false;
    try {
        bech32Decode('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5');
    } catch {
        rejectedBadChecksum = true;
    }
    check('a corrupted checksum is rejected', rejectedBadChecksum);

    return { ok: failures.length === 0, failures };
};

export { CHARSET as BECH32_CHARSET };
