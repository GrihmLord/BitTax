import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyTerm, oneYearAnniversary, daysHeld, tackedHoldingStart, TERM } from '../holdingPeriod.js';
import { parseDate } from '../transactions.js';

const at = (date) => parseDate(date);

test('long term requires more than one year, not one year', () => {
    const acquired = at('2023-01-01');

    assert.equal(classifyTerm(acquired, at('2023-12-31')), TERM.SHORT);
    assert.equal(classifyTerm(acquired, at('2024-01-01')), TERM.SHORT, 'exactly one year is still short term');
    assert.equal(classifyTerm(acquired, at('2024-01-02')), TERM.LONG);
});

test('a same-day disposal is short term', () => {
    assert.equal(classifyTerm(at('2023-05-05'), at('2023-05-05')), TERM.SHORT);
});

/**
 * Rev. Rul. 66-7: property acquired on the last day of a month is held for
 * more than a year once it reaches the first day of the thirteenth month. The
 * previous build rolled the anniversary to 1 March and reported a 1 March sale
 * as short term, overstating the tax on it.
 */
test('a 29 February acquisition is long term from 1 March of the next year', () => {
    assert.equal(oneYearAnniversary(at('2024-02-29')), at('2025-02-28'));
    assert.equal(classifyTerm(at('2024-02-29'), at('2025-02-28')), TERM.SHORT);
    assert.equal(classifyTerm(at('2024-02-29'), at('2025-03-01')), TERM.LONG);
});

test('the term is decided by calendar day, not by time of day', () => {
    // Bought mid-afternoon, sold an hour later on the anniversary: exactly one year.
    assert.equal(classifyTerm(at('2023-01-01T15:00:00Z'), at('2024-01-01T16:00:00Z')), TERM.SHORT);
    assert.equal(classifyTerm(at('2023-01-01T15:00:00Z'), at('2024-01-02T09:00:00Z')), TERM.LONG);
    assert.equal(daysHeld(at('2023-01-01T23:00:00Z'), at('2023-01-02T01:00:00Z')), 1);
});

test('the wash sale holding period is the washed position\'s days, not its start date', () => {
    // Held 31 days (1 Jan to 1 Feb); the replacement bought 15 Feb starts 31 days earlier.
    assert.equal(tackedHoldingStart(at('2023-02-15'), at('2023-01-01'), at('2023-02-01')), at('2023-01-15'));
});

test('a leap day inside the holding period does not shift the anniversary', () => {
    assert.equal(oneYearAnniversary(at('2023-06-15')), at('2024-06-15'));
});

test('dates are anchored in UTC so a lot cannot change year with the timezone', () => {
    assert.equal(at('2023-01-01'), Date.UTC(2023, 0, 1));
    assert.equal(parseDate('2023-01-01T00:00:00.000Z'), Date.UTC(2023, 0, 1));
});

test('daysHeld counts whole days and never goes negative', () => {
    assert.equal(daysHeld(at('2023-01-01'), at('2023-01-31')), 30);
    assert.equal(daysHeld(at('2023-01-01'), at('2023-01-01')), 0);
    assert.equal(daysHeld(at('2023-06-01'), at('2023-01-01')), 0);
});

test('invalid dates are rejected instead of becoming NaN', () => {
    assert.throws(() => parseDate('2023-02-30'), /does not exist/);
    assert.throws(() => parseDate('2023-13-01'), /does not exist/);
    assert.throws(() => parseDate('not a date'), /Unrecognised date/);
    assert.throws(() => parseDate('2023-01-01T24:00:00Z'), /Time does not exist/);
    assert.throws(() => parseDate('13/01/2023'), /not month\/day\/year/);
    assert.throws(() => parseDate(Number.NaN), /Invalid timestamp/);
});

/**
 * `Date.parse` reads a zone-less date-time in the machine's local zone, so the
 * same CSV used to put a trade on a different day — or in a different tax
 * year — depending on where it was audited.
 */
test('zone-less timestamps are UTC, and explicit offsets are honoured', () => {
    assert.equal(parseDate('2023-12-31 23:30:00'), Date.UTC(2023, 11, 31, 23, 30));
    assert.equal(parseDate('2023-12-31T23:30'), Date.UTC(2023, 11, 31, 23, 30));
    assert.equal(parseDate('2024-01-01T01:30:00+02:00'), Date.UTC(2023, 11, 31, 23, 30));
    assert.equal(parseDate('2024-01-01T01:30:00.123456Z'), Date.UTC(2024, 0, 1, 1, 30, 0, 123));
    assert.equal(parseDate('1/5/2024'), Date.UTC(2024, 0, 5));
    assert.equal(parseDate('01/05/2024 14:05'), Date.UTC(2024, 0, 5, 14, 5));
});
