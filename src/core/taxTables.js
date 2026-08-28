/**
 * taxTables.js
 * US federal rate tables, as data.
 *
 * These figures are inflation-adjusted every year by an IRS revenue procedure.
 * Each year carries its `source` and a `verified` flag so a stale table is
 * visible rather than silent: the application refuses to present an unverified
 * table as a filing figure, and says which revenue procedure to check.
 *
 * Limits are the TOP of each bracket in whole dollars of taxable income.
 * Rates are basis points, so all arithmetic stays on integers.
 */

export const FILING_STATUS = Object.freeze({
    SINGLE: 'single',
    MARRIED_JOINT: 'married_joint',
    MARRIED_SEPARATE: 'married_separate',
    HEAD_OF_HOUSEHOLD: 'head_of_household',
});

export const FILING_STATUS_LABELS = Object.freeze({
    [FILING_STATUS.SINGLE]: 'Single',
    [FILING_STATUS.MARRIED_JOINT]: 'Married filing jointly',
    [FILING_STATUS.MARRIED_SEPARATE]: 'Married filing separately',
    [FILING_STATUS.HEAD_OF_HOUSEHOLD]: 'Head of household',
});

const ORDINARY_RATES_BP = [1000, 1200, 2200, 2400, 3200, 3500, 3700];
const LONG_TERM_RATES_BP = [0, 1500, 2000];

/** Builds bracket objects from the six break points that define the seven ordinary bands. */
const ordinary = (limits) => limits
    .map((limit, index) => ({ upToDollars: limit, rateBp: ORDINARY_RATES_BP[index] }))
    .concat([{ upToDollars: null, rateBp: ORDINARY_RATES_BP[ORDINARY_RATES_BP.length - 1] }]);

/** Builds the three long-term capital gains bands from their two break points. */
const longTerm = (limits) => limits
    .map((limit, index) => ({ upToDollars: limit, rateBp: LONG_TERM_RATES_BP[index] }))
    .concat([{ upToDollars: null, rateBp: LONG_TERM_RATES_BP[LONG_TERM_RATES_BP.length - 1] }]);

export const TAX_YEARS = Object.freeze({
    2024: {
        year: 2024,
        source: 'IRS Rev. Proc. 2023-34',
        verified: false,
        ordinary: {
            [FILING_STATUS.SINGLE]: ordinary([11600, 47150, 100525, 191950, 243725, 609350]),
            [FILING_STATUS.MARRIED_JOINT]: ordinary([23200, 94300, 201050, 383900, 487450, 731200]),
            [FILING_STATUS.MARRIED_SEPARATE]: ordinary([11600, 47150, 100525, 191950, 243725, 365600]),
            [FILING_STATUS.HEAD_OF_HOUSEHOLD]: ordinary([16550, 63100, 100500, 191950, 243700, 609350]),
        },
        longTerm: {
            [FILING_STATUS.SINGLE]: longTerm([47025, 518900]),
            [FILING_STATUS.MARRIED_JOINT]: longTerm([94050, 583750]),
            [FILING_STATUS.MARRIED_SEPARATE]: longTerm([47025, 291850]),
            [FILING_STATUS.HEAD_OF_HOUSEHOLD]: longTerm([63000, 551350]),
        },
        niitThresholdDollars: {
            [FILING_STATUS.SINGLE]: 200000,
            [FILING_STATUS.MARRIED_JOINT]: 250000,
            [FILING_STATUS.MARRIED_SEPARATE]: 125000,
            [FILING_STATUS.HEAD_OF_HOUSEHOLD]: 200000,
        },
    },
    2025: {
        year: 2025,
        source: 'IRS Rev. Proc. 2024-40',
        verified: false,
        ordinary: {
            [FILING_STATUS.SINGLE]: ordinary([11925, 48475, 103350, 197300, 250525, 626350]),
            [FILING_STATUS.MARRIED_JOINT]: ordinary([23850, 96950, 206700, 394600, 501050, 751600]),
            [FILING_STATUS.MARRIED_SEPARATE]: ordinary([11925, 48475, 103350, 197300, 250525, 375800]),
            [FILING_STATUS.HEAD_OF_HOUSEHOLD]: ordinary([17000, 64850, 103350, 197300, 250500, 626350]),
        },
        longTerm: {
            [FILING_STATUS.SINGLE]: longTerm([48350, 533400]),
            [FILING_STATUS.MARRIED_JOINT]: longTerm([96700, 600050]),
            [FILING_STATUS.MARRIED_SEPARATE]: longTerm([48350, 300000]),
            [FILING_STATUS.HEAD_OF_HOUSEHOLD]: longTerm([64750, 566700]),
        },
        niitThresholdDollars: {
            [FILING_STATUS.SINGLE]: 200000,
            [FILING_STATUS.MARRIED_JOINT]: 250000,
            [FILING_STATUS.MARRIED_SEPARATE]: 125000,
            [FILING_STATUS.HEAD_OF_HOUSEHOLD]: 200000,
        },
    },
});

/** Net investment income tax, unindexed since enactment. */
export const NIIT_RATE_BP = 380;

export const SUPPORTED_TAX_YEARS = Object.freeze(Object.keys(TAX_YEARS).map(Number).sort());

/**
 * Pinned rather than "the newest table available": bumping this would silently
 * change every figure the tool has ever shown a user. The year is a visible,
 * explicit choice in the UI, and callers that care should pass it.
 */
export const DEFAULT_TAX_YEAR = 2024;

/**
 * @param {number} year
 * @returns {object} the table for that year
 * @throws {RangeError} when no table has been entered for the year
 */
export const getTaxYear = (year) => {
    const table = TAX_YEARS[year];
    if (!table) {
        throw new RangeError(
            `No tax table for ${year}. Available: ${SUPPORTED_TAX_YEARS.join(', ')}. `
            + 'Add the year from the corresponding IRS revenue procedure before using it.',
        );
    }
    return table;
};
