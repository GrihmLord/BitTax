import test from 'node:test';
import assert from 'node:assert/strict';

import { TAX_YEARS, SUPPORTED_TAX_YEARS, DEFAULT_TAX_YEAR, FILING_STATUS } from '../taxTables.js';

/**
 * Every figure in a table marked `verified` is pinned here, transcribed from
 * the revenue procedure named in its `source`. Editing a table without editing
 * this file fails the build, so a typo cannot reach a user's estimate.
 *
 * Ordinary: the top of the 10/12/22/24/32/35% bands. Long term: the top of the
 * 0% and 15% bands.
 */
const PUBLISHED = {
    2024: {
        ordinary: {
            single: [11600, 47150, 100525, 191950, 243725, 609350],
            married_joint: [23200, 94300, 201050, 383900, 487450, 731200],
            married_separate: [11600, 47150, 100525, 191950, 243725, 365600],
            head_of_household: [16550, 63100, 100500, 191950, 243700, 609350],
        },
        longTerm: {
            single: [47025, 518900],
            married_joint: [94050, 583750],
            married_separate: [47025, 291850],
            head_of_household: [63000, 551350],
        },
    },
    2025: {
        ordinary: {
            single: [11925, 48475, 103350, 197300, 250525, 626350],
            married_joint: [23850, 96950, 206700, 394600, 501050, 751600],
            married_separate: [11925, 48475, 103350, 197300, 250525, 375800],
            head_of_household: [17000, 64850, 103350, 197300, 250500, 626350],
        },
        longTerm: {
            single: [48350, 533400],
            married_joint: [96700, 600050],
            married_separate: [48350, 300000],
            head_of_household: [64750, 566700],
        },
    },
    2026: {
        ordinary: {
            single: [12400, 50400, 105700, 201775, 256225, 640600],
            married_joint: [24800, 100800, 211400, 403550, 512450, 768700],
            married_separate: [12400, 50400, 105700, 201775, 256225, 384350],
            head_of_household: [17700, 67450, 105700, 201750, 256200, 640600],
        },
        longTerm: {
            single: [49450, 545500],
            married_joint: [98900, 613700],
            married_separate: [49450, 306850],
            head_of_household: [66200, 579600],
        },
    },
};

const limits = (brackets) => brackets.filter((b) => b.upToDollars !== null).map((b) => b.upToDollars);

test('every verified table matches its published revenue procedure', () => {
    for (const year of SUPPORTED_TAX_YEARS) {
        const table = TAX_YEARS[year];
        if (!table.verified) continue;
        const published = PUBLISHED[year];
        assert.ok(published, `${year} is marked verified but has no pinned figures`);
        for (const status of Object.values(FILING_STATUS)) {
            assert.deepEqual(limits(table.ordinary[status]), published.ordinary[status], `${year} ordinary ${status}`);
            assert.deepEqual(limits(table.longTerm[status]), published.longTerm[status], `${year} long term ${status}`);
        }
    }
});

test('rates and structure are the same in every year', () => {
    for (const year of SUPPORTED_TAX_YEARS) {
        const table = TAX_YEARS[year];
        for (const status of Object.values(FILING_STATUS)) {
            assert.deepEqual(table.ordinary[status].map((b) => b.rateBp), [1000, 1200, 2200, 2400, 3200, 3500, 3700]);
            assert.deepEqual(table.longTerm[status].map((b) => b.rateBp), [0, 1500, 2000]);
            const bands = limits(table.ordinary[status]);
            assert.deepEqual(bands, [...bands].sort((a, b) => a - b), `${year} ${status} bands ascend`);
        }
    }
});

test('years are listed in order and the default is shipped', () => {
    assert.deepEqual(SUPPORTED_TAX_YEARS, [...SUPPORTED_TAX_YEARS].sort((a, b) => a - b));
    assert.ok(SUPPORTED_TAX_YEARS.includes(DEFAULT_TAX_YEAR));
});
