/**
 * decimal.js
 * Exact fixed-point arithmetic on BigInt base units.
 *
 * Every quantity in BitTax is stored as an integer count of base units so that
 * no amount on a tax document is ever the result of binary floating point.
 * Bitcoin is 8 decimals (satoshi), Ethereum 18 (wei), USD 2 (cent).
 */

const DIGITS = /^\d+$/;

/** Precomputed powers of ten, grown on demand. */
const POW10 = [1n];
const pow10 = (n) => {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`pow10 requires a non-negative integer, got ${n}`);
    while (POW10.length <= n) POW10.push(POW10[POW10.length - 1] * 10n);
    return POW10[n];
};

/**
 * Rounds `numerator / denominator` half away from zero.
 * Denominator must be positive; the numerator carries the sign.
 */
const divRound = (numerator, denominator) => {
    if (denominator <= 0n) throw new RangeError('divRound requires a positive denominator');
    const negative = numerator < 0n;
    const abs = negative ? -numerator : numerator;
    const quotient = abs / denominator;
    const remainder = abs - quotient * denominator;
    const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
    return negative ? -rounded : rounded;
};

/** Computes `a * b / denominator` in one step, rounding half away from zero. */
export const mulDiv = (a, b, denominator) => divRound(a * b, denominator);

/**
 * Splits a decimal string into sign, integer digits and fraction digits.
 * Rejects exponent notation, thousands separators and anything else that would
 * otherwise be silently coerced.
 */
const splitDecimal = (text) => {
    const trimmed = text.trim();
    if (trimmed === '') throw new TypeError('Amount is empty');

    let sign = 1n;
    let body = trimmed;
    if (body[0] === '+' || body[0] === '-') {
        if (body[0] === '-') sign = -1n;
        body = body.slice(1);
    }

    const parts = body.split('.');
    if (parts.length > 2) throw new TypeError(`Malformed decimal: ${text}`);

    const whole = parts[0] === '' ? '0' : parts[0];
    const fraction = parts.length === 2 ? parts[1] : '';

    if (!DIGITS.test(whole)) throw new TypeError(`Malformed decimal: ${text}`);
    if (fraction !== '' && !DIGITS.test(fraction)) throw new TypeError(`Malformed decimal: ${text}`);

    return { sign, whole, fraction };
};

/**
 * Converts a human decimal value into an integer count of base units.
 *
 * Numbers are accepted for ergonomics but routed through their shortest
 * round-trip string form, so `parseUnits(0.1, 8)` is exactly 10000000n rather
 * than the 0.1000000000000000055... that the double actually holds.
 *
 * @param {string|number|bigint} value
 * @param {number} decimals - base units per whole unit, as a power of ten
 * @returns {bigint}
 */
export const parseUnits = (value, decimals) => {
    if (typeof value === 'bigint') return value * pow10(decimals);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`Amount is not finite: ${value}`);
        return parseUnits(numberToPlainString(value), decimals);
    }
    if (typeof value !== 'string') throw new TypeError(`Unsupported amount type: ${typeof value}`);

    const { sign, whole, fraction } = splitDecimal(value);
    if (fraction.length > decimals) {
        throw new RangeError(`Amount ${value} has more than ${decimals} decimal places and cannot be represented exactly`);
    }

    const padded = fraction.padEnd(decimals, '0');
    return sign * (BigInt(whole) * pow10(decimals) + (decimals > 0 ? BigInt(padded) : 0n));
};

/**
 * Renders a `number` without exponent notation so it can be parsed digit by digit.
 * JavaScript switches to exponent form below 1e-6 and at/above 1e21.
 */
const numberToPlainString = (value) => {
    const text = String(value);
    if (!text.includes('e') && !text.includes('E')) return text;

    const [mantissa, exponentText] = text.split(/[eE]/);
    const exponent = Number(exponentText);
    const negative = mantissa.startsWith('-');
    const digits = negative ? mantissa.slice(1) : mantissa;
    const [whole, fraction = ''] = digits.split('.');
    const all = whole + fraction;
    const pointIndex = whole.length + exponent;

    let out;
    if (pointIndex <= 0) out = `0.${'0'.repeat(-pointIndex)}${all}`;
    else if (pointIndex >= all.length) out = all + '0'.repeat(pointIndex - all.length);
    else out = `${all.slice(0, pointIndex)}.${all.slice(pointIndex)}`;

    return negative ? `-${out}` : out;
};

/**
 * Renders base units back as a decimal string.
 *
 * @param {bigint} units
 * @param {number} decimals
 * @param {{ trim?: boolean, minFractionDigits?: number }} [options]
 *   trim - drop trailing fractional zeros (default true)
 *   minFractionDigits - keep at least this many fractional digits
 */
export const formatUnits = (units, decimals, options = {}) => {
    const { trim = true, minFractionDigits = 0 } = options;
    if (typeof units !== 'bigint') throw new TypeError('formatUnits requires a bigint');

    const negative = units < 0n;
    const abs = negative ? -units : units;
    const divisor = pow10(decimals);
    const whole = (abs / divisor).toString();

    if (decimals === 0) return negative ? `-${whole}` : whole;

    let fraction = (abs % divisor).toString().padStart(decimals, '0');
    if (trim) fraction = fraction.replace(/0+$/, '');
    while (fraction.length < minFractionDigits) fraction += '0';

    const body = fraction === '' ? whole : `${whole}.${fraction}`;
    return negative ? `-${body}` : body;
};

/**
 * Rescales base units from one decimal precision to another, rounding
 * half away from zero when precision is lost.
 */
export const rescale = (units, fromDecimals, toDecimals) => {
    if (toDecimals >= fromDecimals) return units * pow10(toDecimals - fromDecimals);
    return divRound(units, pow10(fromDecimals - toDecimals));
};

export const absBigInt = (value) => (value < 0n ? -value : value);

export const minBigInt = (a, b) => (a < b ? a : b);

export const maxBigInt = (a, b) => (a > b ? a : b);

export { pow10, divRound };
