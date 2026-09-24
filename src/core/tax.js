/**
 * tax.js
 * Federal tax estimation on integer cents.
 *
 * Models the stacking rules of the Qualified Dividends and Capital Gain Tax
 * Worksheet: net short term gain is ordinary income; net long term gain sits
 * on top of ordinary income and is taxed at the preferential rates from that
 * point upward; the net investment income surtax applies above its own
 * threshold. Netting and the loss limit follow Schedule D, including the
 * character of any carryover.
 *
 * This is an estimate for planning. It models federal tax only — no state
 * tax, no AMT, no credits, no phase-outs. `ordinaryIncomeCents` is taxable
 * income before capital results (i.e. after the standard or itemised
 * deduction), and NIIT uses it as a stand-in for MAGI.
 */

import { getTaxYear, DEFAULT_TAX_YEAR, FILING_STATUS, NIIT_RATE_BP } from './taxTables.js';
import { mulDiv, maxBigInt, minBigInt } from './decimal.js';

const BASIS_POINTS = 10000n;
const CENTS_PER_DOLLAR = 100n;

/** Annual cap on net capital losses deductible against ordinary income (26 U.S.C. 1211(b)). */
export const CAPITAL_LOSS_DEDUCTION_LIMIT_CENTS = 300000n;
/** The same cap for married individuals filing separately. */
export const CAPITAL_LOSS_DEDUCTION_LIMIT_MFS_CENTS = 150000n;

export const capitalLossLimitFor = (filingStatus) => (filingStatus === FILING_STATUS.MARRIED_SEPARATE
    ? CAPITAL_LOSS_DEDUCTION_LIMIT_MFS_CENTS
    : CAPITAL_LOSS_DEDUCTION_LIMIT_CENTS);

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
 * Nets short and long term results the way Schedule D does and splits any
 * unused loss into short and long term carryovers.
 *
 * Carryovers keep their character (Schedule D Capital Loss Carryover
 * Worksheet): the deduction is taken from the short term loss first, so what
 * remains of a long term loss carries forward as long term.
 *
 * @param {bigint} shortTermCents - this year's short term result, less any short term carryover in
 * @param {bigint} longTermCents - likewise for long term
 * @param {bigint} limitCents - the annual deduction limit for the filing status
 */
export const netCapitalResult = (shortTermCents, longTermCents, limitCents = CAPITAL_LOSS_DEDUCTION_LIMIT_CENTS) => {
    const total = shortTermCents + longTermCents;
    if (total >= 0n) {
        // A loss in one class offsets a gain in the other before rates apply.
        return {
            netShort: maxBigInt(shortTermCents + minBigInt(longTermCents, 0n), 0n),
            netLong: maxBigInt(longTermCents + minBigInt(shortTermCents, 0n), 0n),
            deductibleLossCents: 0n,
            carryforwardShortTermCents: 0n,
            carryforwardLongTermCents: 0n,
        };
    }

    // After cross-class offset, what loss is left in each class.
    let shortLoss = maxBigInt(-shortTermCents, 0n);
    let longLoss = maxBigInt(-longTermCents, 0n);
    if (shortTermCents > 0n) longLoss -= shortTermCents;
    if (longTermCents > 0n) shortLoss -= longTermCents;

    const deductible = minBigInt(-total, limitCents);
    const fromShort = minBigInt(shortLoss, deductible);
    const fromLong = deductible - fromShort;

    return {
        netShort: 0n,
        netLong: 0n,
        deductibleLossCents: deductible,
        carryforwardShortTermCents: shortLoss - fromShort,
        carryforwardLongTermCents: longLoss - fromLong,
    };
};

/** The 3.8% surtax on the lesser of net investment income and income over the threshold. */
const netInvestmentIncomeTax = (investmentIncomeCents, totalIncomeCents, table, filingStatus) => {
    const threshold = toCents(table.niitThresholdDollars[filingStatus]);
    const excess = maxBigInt(totalIncomeCents - threshold, 0n);
    const base = minBigInt(maxBigInt(investmentIncomeCents, 0n), excess);
    return mulDiv(base, BigInt(NIIT_RATE_BP), BASIS_POINTS);
};

const requireNonNegative = (value, name) => {
    if (typeof value !== 'bigint') throw new TypeError(`${name} must be a bigint number of cents`);
    if (value < 0n) throw new RangeError(`${name} is a loss amount and must be entered as a positive figure`);
    return value;
};

/**
 * Full estimate for a year.
 *
 * @param {object} input
 * @param {bigint} [input.ordinaryIncomeCents=0n] - taxable income before capital results
 * @param {bigint} [input.shortTermGainCents=0n]
 * @param {bigint} [input.longTermGainCents=0n]
 * @param {bigint} [input.carryoverShortTermLossCents=0n] - prior-year short term carryover, as a positive figure
 * @param {bigint} [input.carryoverLongTermLossCents=0n] - prior-year long term carryover, as a positive figure
 * @param {string} [input.filingStatus='single']
 * @param {number} [input.year]
 * @returns {object} a full breakdown, every figure in integer cents
 */
export const estimateTax = ({
    ordinaryIncomeCents = 0n,
    shortTermGainCents = 0n,
    longTermGainCents = 0n,
    carryoverShortTermLossCents = 0n,
    carryoverLongTermLossCents = 0n,
    filingStatus = FILING_STATUS.SINGLE,
    year = DEFAULT_TAX_YEAR,
} = {}) => {
    const table = getTaxYear(year);
    const ordinaryBrackets = resolveBrackets(table, 'ordinary', filingStatus);
    const longTermBrackets = resolveBrackets(table, 'longTerm', filingStatus);

    const carryShort = requireNonNegative(carryoverShortTermLossCents, 'carryoverShortTermLossCents');
    const carryLong = requireNonNegative(carryoverLongTermLossCents, 'carryoverLongTermLossCents');
    const limit = capitalLossLimitFor(filingStatus);

    const netting = netCapitalResult(shortTermGainCents - carryShort, longTermGainCents - carryLong, limit);
    const { netShort, netLong, deductibleLossCents } = netting;

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
        lossLimitCents: limit,
        carryforwardShortTermCents: netting.carryforwardShortTermCents,
        carryforwardLongTermCents: netting.carryforwardLongTermCents,
        carryforwardCents: netting.carryforwardShortTermCents + netting.carryforwardLongTermCents,
        ordinaryTaxCents: ordinary.taxCents,
        longTermTaxCents: longTerm.taxCents,
        niitCents,
        totalTaxCents,
        marginalOrdinaryRateBp: ordinary.marginalRateBp,
        marginalLongTermRateBp: longTerm.marginalRateBp,
        effectiveRateBp: totalIncomeCents > 0n ? Number(mulDiv(totalTaxCents, BASIS_POINTS, totalIncomeCents)) : 0,
    };
};

/** Renders a basis-point rate for display, e.g. 2200 -> "22%", 380 -> "3.8%", 1225 -> "12.25%". */
export const formatRateBp = (rateBp) => {
    const whole = Math.trunc(rateBp / 100);
    const fraction = Math.abs(rateBp % 100);
    if (fraction === 0) return `${whole}%`;
    return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}%`;
};

export { FILING_STATUS, DEFAULT_TAX_YEAR };
