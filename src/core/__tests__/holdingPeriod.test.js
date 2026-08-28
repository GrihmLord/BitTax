import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyTerm, oneYearAnniversary, daysHeld, TERM } from '../holdingPeriod.js';
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

test('a 29 February acquisition rolls to 1 March in a non-leap year', () => {
    assert.equal(oneYearAnniversary(at('2024-02-29')), at('2025-03-01'));
    assert.equal(classifyTerm(at('2024-02-29'), at('2025-03-01')), TERM.SHORT);
    assert.equal(classifyTerm(at('2024-02-29'), at('2025-03-02')), TERM.LONG);
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
    assert.throws(() => parseDate(Number.NaN), /Invalid timestamp/);
});
