/**
 * tax.js
 * Federal tax estimation on integer cents.
 *
 * Replaces a flat 22% guess with the actual stacking rules: short term gains
 * are ordinary income, long term gains sit on top of ordinary income and are
 * taxed at the preferential rates from that point upward, and the net
 * investment income surtax applies above its own threshold.
 *
 * This is an estimate for planning. It models federal tax only — no state
 * tax, no AMT, no credits, no phase-outs, no carryforward from prior years.
 */

import { getTaxYear, DEFAULT_TAX_YEAR, FILING_STATUS, NIIT_RATE_BP } from './taxTables.js';
import { parseUSD, formatUSD } from './money.js';
import { mulDiv, maxBigInt, minBigInt } from './decimal.js';

const BASIS_POINTS = 10000n;
const CENTS_PER_DOLLAR = 100n;

/** Annual cap on net capital losses deductible against ordinary income (26 U.S.C. 1211(b)). */
export const CAPITAL_LOSS_DEDUCTION_LIMIT_CENTS = 300000n;

const toCents = (dollars) => BigInt(dollars) * CENTS_PER_DOLLAR;

const resolveBrackets = (table, key, filingStatus) => {
    const brackets = table[key][filingStatus];
    if (!brackets) {
        throw new RangeError(`Unknown filing status "${filingStatus}". Expected one of: ${Object.values(FILING_STATUS).join(', ')}`);
    }
    return brackets;
};

/**
 * Taxes `amountCents` sitting on top of `floorCents` of other income, using a
 * marginal bracket table. The floor is what makes stacking work: long term
 * gains are charged at the rate that applies *after* ordinary income has
 * already filled the lower bands.
 *
 * @param {bigint} amountCents - the slice being taxed
 * @param {bigint} floorCents - income already stacked beneath it
 * @param {Array<{upToDollars:number|null, rateBp:number}>} brackets
 * @returns {{taxCents: bigint, marginalRateBp: number}}
 */
export const taxSlice = (amountCents, floorCents, brackets) => {
    if (amountCents <= 0n) return { taxCents: 0n, marginalRateBp: 0 };

    let taxCents = 0n;
    let marginalRateBp = 0;
    let cursor = floorCents;
    const ceiling = floorCents + amountCents;

    for (const bracket of brackets) {
        const limit = bracket.upToDollars === null ? ceiling : toCents(bracket.upToDollars);
        if (limit <= cursor) continue;

        const slice = minBigInt(limit, ceiling) - cursor;
        if (slice > 0n) {
            taxCents += mulDiv(slice, BigInt(bracket.rateBp), BASIS_POINTS);
            marginalRateBp = bracket.rateBp;
            cursor += slice;
        }
        if (cursor >= ceiling) break;
    }

    return { taxCents, marginalRateBp };
};

/**
 * Ordinary income tax on a taxable income figure.
 *
 * @param {bigint} taxableIncomeCents
 * @param {string} filingStatus
 * @param {number} year
 */
export const ordinaryIncomeTax = (taxableIncomeCents, filingStatus = FILING_STATUS.SINGLE, year = DEFAULT_TAX_YEAR) => {
    const table = getTaxYear(year);
    return taxSlice(maxBigInt(taxableIncomeCents, 0n), 0n, resolveBrackets(table, 'ordinary', filingStatus));
};

/**
 * Nets short and long term results together the way Schedule D does, and caps
 * the amount of a net loss that can offset ordinary income this year.
 */
const netCapitalResult = (shortTermGainCents, longTermGainCents) => {
    const total = shortTermGainCents + longTermGainCents;
    if (total >= 0n) {
        // A loss in one class offsets a gain in the other before rates apply.
        const netShort = maxBigInt(shortTermGainCents + minBigInt(longTermGainCents, 0n), 0n);
        const netLong = maxBigInt(longTermGainCents + minBigInt(shortTermGainCents, 0n), 0n);
        return { netShort, netLong, deductibleLossCents: 0n, carryforwardCents: 0n };
    }

    const deductible = maxBigInt(total, -CAPITAL_LOSS_DEDUCTION_LIMIT_CENTS);
    return {
        netShort: 0n,
        netLong: 0n,
        deductibleLossCents: -deductible,
        carryforwardCents: -(total - deductible),
    };
};

/** The 3.8% surtax on the lesser of net investment income and income over the threshold. */
const netInvestmentIncomeTax = (investmentIncomeCents, totalIncomeCents, table, filingStatus) => {
    const threshold = toCents(table.niitThresholdDollars[filingStatus]);
    const excess = maxBigInt(totalIncomeCents - threshold, 0n);
    const base = minBigInt(maxBigInt(investmentIncomeCents, 0n), excess);
    return mulDiv(base, BigInt(NIIT_RATE_BP), BASIS_POINTS);
};

/**
 * Full estimate for a year.
 *
 * @param {object} input
 * @param {bigint} [input.ordinaryIncomeCents=0n] - taxable income before capital results
 * @param {bigint} [input.shortTermGainCents=0n]
 * @param {bigint} [input.longTermGainCents=0n]
 * @param {string} [input.filingStatus='single']
 * @param {number} [input.year]
 * @returns {object} a full breakdown, every figure in integer cents
 */
export const estimateTax = ({
    ordinaryIncomeCents = 0n,
    shortTermGainCents = 0n,
    longTermGainCents = 0n,
    filingStatus = FILING_STATUS.SINGLE,
    year = DEFAULT_TAX_YEAR,
} = {}) => {
    const table = getTaxYear(year);
    const ordinaryBrackets = resolveBrackets(table, 'ordinary', filingStatus);
    const longTermBrackets = resolveBrackets(table, 'longTerm', filingStatus);

    const { netShort, netLong, deductibleLossCents, carryforwardCents } = netCapitalResult(shortTermGainCents, longTermGainCents);

    const ordinaryBase = maxBigInt(ordinaryIncomeCents - deductibleLossCents, 0n) + netShort;
    const ordinary = taxSlice(ordinaryBase, 0n, ordinaryBrackets);
    const longTerm = taxSlice(netLong, ordinaryBase, longTermBrackets);

    const totalIncomeCents = ordinaryBase + netLong;
    const niitCents = netInvestmentIncomeTax(netShort + netLong, totalIncomeCents, table, filingStatus);
    const totalTaxCents = ordinary.taxCents + longTerm.taxCents + niitCents;

    return {
        year: table.year,
        source: table.source,
        verified: table.verified,
        filingStatus,
        ordinaryBaseCents: ordinaryBase,
        netShortTermGainCents: netShort,
        netLongTermGainCents: netLong,
        deductibleLossCents,
        carryforwardCents,
        ordinaryTaxCents: ordinary.taxCents,
        longTermTaxCents: longTerm.taxCents,
        niitCents,
        totalTaxCents,
        marginalOrdinaryRateBp: ordinary.marginalRateBp,
        marginalLongTermRateBp: longTerm.marginalRateBp,
        effectiveRateBp: totalIncomeCents > 0n ? Number(mulDiv(totalTaxCents, BASIS_POINTS, totalIncomeCents)) : 0,
    };
};

/** Renders a basis-point rate for display, e.g. 2200 -> "22%". */
export const formatRateBp = (rateBp) => {
    const whole = Math.floor(rateBp / 100);
    const fraction = rateBp % 100;
    return fraction === 0 ? `${whole}%` : `${(rateBp / 100).toFixed(1)}%`;
};

/**
 * Dollar-denominated convenience wrapper preserving the original TaxService
 * signature, so existing callers and tests keep working.
 *
 * @param {number|string} income - taxable income in dollars
 * @param {string} [filingStatus='single']
 * @param {number} [year]
 * @returns {number} tax owed in dollars
 */
export const calculateTax = (income, filingStatus = FILING_STATUS.SINGLE, year = DEFAULT_TAX_YEAR) => {
    const { taxCents } = ordinaryIncomeTax(parseUSD(income), filingStatus, year);
    return Number(taxCents) / 100;
};

export const formatCurrency = (amount) => formatUSD(typeof amount === 'bigint' ? amount : parseUSD(amount));

export { FILING_STATUS, DEFAULT_TAX_YEAR };
