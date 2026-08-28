/**
 * holdingPeriod.js
 * Short vs long term classification for Form 8949.
 *
 * IRS Pub 544: the holding period begins the day after the property is
 * acquired, and a gain is long term only when the property was held for
 * *more than* one year. A sale on the one-year anniversary is therefore
 * still short term.
 */

export const TERM = Object.freeze({ SHORT: 'SHORT', LONG: 'LONG' });

/**
 * The one-year anniversary of an acquisition, in epoch milliseconds.
 * A 29 February acquisition rolls to 1 March in a non-leap year, matching the
 * conventional treatment.
 */
export const oneYearAnniversary = (acquiredAt) => {
    const acquired = new Date(acquiredAt);
    return Date.UTC(
        acquired.getUTCFullYear() + 1,
        acquired.getUTCMonth(),
        acquired.getUTCDate(),
        acquired.getUTCHours(),
        acquired.getUTCMinutes(),
        acquired.getUTCSeconds(),
        acquired.getUTCMilliseconds(),
    );
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
    (soldAt > oneYearAnniversary(holdingStartAt) ? TERM.LONG : TERM.SHORT);

/** Whole days a position was held, for display. */
export const daysHeld = (holdingStartAt, soldAt) =>
    Math.max(0, Math.floor((soldAt - holdingStartAt) / 86400000));
