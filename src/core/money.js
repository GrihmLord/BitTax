/**
 * money.js
 * US dollars as integer cents. Every figure that can reach a tax form is
 * produced here, never by floating point multiplication.
 */

import { parseUnits, formatUnits, mulDiv, pow10 } from './decimal.js';

export const USD_DECIMALS = 2;

/** Parses a dollar string or number into integer cents. */
export const parseUSD = (value) => parseUnits(value, USD_DECIMALS);

/**
 * Converts a unit price expressed in dollars per whole asset into cents,
 * keeping sub-cent precision so tiny holdings still price correctly.
 * Prices are held at `PRICE_DECIMALS` places beyond the cent.
 */
export const PRICE_DECIMALS = 8;

/** Parses a price (dollars per whole unit) into the internal fixed-point scale. */
export const parsePrice = (value) => parseUnits(value, PRICE_DECIMALS);

/**
 * Values a holding: `units` base units of an asset at `price` (internal scale)
 * produces integer cents, rounded half away from zero.
 *
 * @param {bigint} units - base units of the asset (e.g. satoshis)
 * @param {number} decimals - the asset's decimals
 * @param {bigint} price - dollars-per-whole-unit at PRICE_DECIMALS scale
 * @returns {bigint} cents
 */
export const valueOf = (units, decimals, price) =>
    mulDiv(units, price, pow10(decimals + PRICE_DECIMALS - USD_DECIMALS));

/**
 * Derives an effective unit price from a total value and a quantity.
 * Used to fold trade fees into a lot's cost basis.
 *
 * @param {bigint} cents - total consideration
 * @param {bigint} units - base units transacted (must be non-zero)
 * @param {number} decimals - the asset's decimals
 * @returns {bigint} price at PRICE_DECIMALS scale
 */
export const priceFrom = (cents, units, decimals) => {
    if (units === 0n) throw new RangeError('Cannot derive a unit price from a zero quantity');
    return mulDiv(cents, pow10(decimals + PRICE_DECIMALS - USD_DECIMALS), units);
};

/**
 * Allocates `cents` in proportion to `part / whole` without losing or
 * inventing a cent. Callers that split a total across lots must use this.
 */
export const allocate = (cents, part, whole) => {
    if (whole === 0n) throw new RangeError('Cannot allocate against a zero total');
    return mulDiv(cents, part, whole);
};

const USD_FORMAT = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/**
 * Formats integer cents as a display string.
 * Goes through the exact decimal representation rather than `Number(cents)/100`,
 * so values beyond 2^53 cents still render correctly.
 */
export const formatUSD = (cents) => {
    const negative = cents < 0n;
    const abs = negative ? -cents : cents;
    const text = USD_FORMAT.format(Number(abs / 100n)).replace(/\.00$/, '');
    const fraction = (abs % 100n).toString().padStart(2, '0');
    return `${negative ? '-' : ''}${text}.${fraction}`;
};

/** Formats integer cents as a bare decimal string, for CSV and machine output. */
export const usdToDecimalString = (cents) => formatUnits(cents, USD_DECIMALS, { trim: false, minFractionDigits: 2 });

/** Formats a price back to a plain decimal string. */
export const priceToDecimalString = (price) => formatUnits(price, PRICE_DECIMALS, { trim: true, minFractionDigits: 2 });

/**
 * Percentage with one decimal place, returned as a string.
 * Returns null for a non-positive denominator rather than emitting NaN or
 * throwing — an empty portfolio has no allocation, it does not have 0%.
 */
export const percentOf = (part, whole) => {
    if (whole <= 0n) return null;
    const tenths = mulDiv(part * 1000n, 1n, whole);
    return `${formatUnits(tenths, 1, { trim: false, minFractionDigits: 1 })}%`;
};

/** Ratio as a float in [0,1] for layout maths only. Never used for money. */
export const ratioOf = (part, whole) => {
    if (whole <= 0n || part <= 0n) return 0;
    return Number(mulDiv(part * 1000000n, 1n, whole)) / 1000000;
};
