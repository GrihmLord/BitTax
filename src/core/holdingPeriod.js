/**
 * holdingPeriod.js
 * Short vs long term classification for Form 8949.
 *
 * IRS Pub 544: the holding period begins the day after the property is
 * acquired and includes the day it is disposed of; a gain is long term only
 * when the property was held for *more than* one year. A sale on the one-year
 * anniversary is therefore still short term.
 *
 * Everything here works on calendar days, not milliseconds. A lot bought at
 * 15:00 and sold on its anniversary at 16:00 is held exactly one year, not one
 * year and an hour.
 */

import { DAY_MS, dayNumber } from './transactions.js';

export const TERM = Object.freeze({ SHORT: 'SHORT', LONG: 'LONG' });

/**
 * The one-year anniversary of an acquisition, as UTC midnight of that date.
 *
 * Property acquired on the last day of a month is long term from the first day
 * of the thirteenth month (Rev. Rul. 66-7). For 29 February that means the
 * anniversary is 28 February of the following year, and a sale on 1 March is
 * long term. Rolling the anniversary forward to 1 March instead would report
 * that sale as short term and overstate the tax.
 *
 * @param {number} acquiredAt - epoch milliseconds
 * @returns {number} epoch milliseconds
 */
export const oneYearAnniversary = (acquiredAt) => {
    const acquired = new Date(acquiredAt);
    const year = acquired.getUTCFullYear() + 1;
    const month = acquired.getUTCMonth();
    const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Date.UTC(year, month, Math.min(acquired.getUTCDate(), lastDayOfTargetMonth));
};

/**
 * Classifies a disposal.
 *
 * @param {number} holdingStartAt - acquisition time, possibly pushed earlier by
 *   wash-sale holding period tacking
 * @param {number} soldAt
 * @returns {'SHORT'|'LONG'}
 */
export const classifyTerm = (holdingStartAt, soldAt) =>
    (dayNumber(soldAt) > dayNumber(oneYearAnniversary(holdingStartAt)) ? TERM.LONG : TERM.SHORT);

/** Whole calendar days a position was held, for display. */
export const daysHeld = (holdingStartAt, soldAt) =>
    Math.max(0, dayNumber(soldAt) - dayNumber(holdingStartAt));

/**
 * The start of the holding period a wash-sale replacement inherits.
 *
 * 26 U.S.C. 1223(3): the replacement's holding period includes the period the
 * washed position was held. The replacement is therefore treated as acquired
 * that many days before it actually was. Taking the earlier of the two start
 * dates instead would also credit the gap between the sale and the repurchase,
 * which the statute does not.
 *
 * @param {number} replacementAcquiredAt
 * @param {number} soldHoldingStartAt
 * @param {number} soldAt
 * @returns {number} epoch milliseconds (UTC midnight)
 */
export const tackedHoldingStart = (replacementAcquiredAt, soldHoldingStartAt, soldAt) =>
    (dayNumber(replacementAcquiredAt) - daysHeld(soldHoldingStartAt, soldAt)) * DAY_MS;

/** The UTC calendar year of a timestamp: the tax year a disposal belongs to. */
export const taxYearOf = (ms) => new Date(ms).getUTCFullYear();
