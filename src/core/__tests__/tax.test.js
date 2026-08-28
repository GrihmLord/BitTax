import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateTax, ordinaryIncomeTax, calculateTax, formatRateBp, CAPITAL_LOSS_DEDUCTION_LIMIT_CENTS } from '../tax.js';
import { FILING_STATUS, SUPPORTED_TAX_YEARS, getTaxYear } from '../taxTables.js';

const usd = (dollars) => BigInt(Math.round(dollars * 100));

test('ordinary brackets are applied marginally', () => {
    // 2024 single: 10% to 11,600, then 12%.
    assert.equal(ordinaryIncomeTax(usd(10000), FILING_STATUS.SINGLE, 2024).taxCents, usd(1000));
    // 11,600 x 10% = 1,160, then 8,400 x 12% = 1,008.
    assert.equal(ordinaryIncomeTax(usd(20000), FILING_STATUS.SINGLE, 2024).taxCents, usd(2168));
    assert.equal(ordinaryIncomeTax(0n, FILING_STATUS.SINGLE, 2024).taxCents, 0n);
    assert.equal(ordinaryIncomeTax(usd(-500), FILING_STATUS.SINGLE, 2024).taxCents, 0n);
});

test('filing status changes the result', () => {
    const single = ordinaryIncomeTax(usd(50000), FILING_STATUS.SINGLE, 2024).taxCents;
    const joint = ordinaryIncomeTax(usd(50000), FILING_STATUS.MARRIED_JOINT, 2024).taxCents;
    const head = ordinaryIncomeTax(usd(50000), FILING_STATUS.HEAD_OF_HOUSEHOLD, 2024).taxCents;

    assert.ok(joint < single, 'married filing jointly pays less at this income');
    assert.ok(head < single, 'head of household pays less at this income');
});

test('all four filing statuses are supported for every shipped year', () => {
    for (const year of SUPPORTED_TAX_YEARS) {
        const table = getTaxYear(year);
        for (const status of Object.values(FILING_STATUS)) {
            assert.ok(table.ordinary[status], `${year} ordinary ${status}`);
            assert.ok(table.longTerm[status], `${year} long term ${status}`);
        }
    }
});

/** The old UI multiplied every gain by a flat 22%, short or long, rich or poor. */
test('long term gains inside the zero rate band are not taxed', () => {
    const result = estimateTax({
        longTermGainCents: usd(40000),
        filingStatus: FILING_STATUS.SINGLE,
        year: 2024,
    });

    assert.equal(result.longTermTaxCents, 0n);
    assert.equal(result.totalTaxCents, 0n);
});

test('long term gains stack on top of ordinary income', () => {
    const result = estimateTax({
        ordinaryIncomeCents: usd(100000),
        longTermGainCents: usd(20000),
        filingStatus: FILING_STATUS.SINGLE,
        year: 2024,
    });

    // Ordinary income has already filled the 0% band, so the gain is taxed at 15%.
    assert.equal(result.longTermTaxCents, usd(3000));
    assert.equal(result.ordinaryTaxCents, usd(17053));
    assert.equal(result.totalTaxCents, usd(20053));
    assert.equal(result.marginalLongTermRateBp, 1500);
});

test('short term gains are taxed as ordinary income', () => {
    const asShortTerm = estimateTax({ ordinaryIncomeCents: usd(50000), shortTermGainCents: usd(10000), year: 2024 });
    const asOrdinary = estimateTax({ ordinaryIncomeCents: usd(60000), year: 2024 });

    assert.equal(asShortTerm.totalTaxCents, asOrdinary.totalTaxCents);
});

test('a loss in one class offsets a gain in the other', () => {
    const result = estimateTax({
        shortTermGainCents: usd(-5000),
        longTermGainCents: usd(15000),
        year: 2024,
    });

    assert.equal(result.netLongTermGainCents, usd(10000));
    assert.equal(result.netShortTermGainCents, 0n);
});

test('a net capital loss is capped at the annual deduction and carried forward', () => {
    const result = estimateTax({
        ordinaryIncomeCents: usd(50000),
        shortTermGainCents: usd(-10000),
        year: 2024,
    });

    assert.equal(result.deductibleLossCents, CAPITAL_LOSS_DEDUCTION_LIMIT_CENTS);
    assert.equal(result.deductibleLossCents, usd(3000));
    assert.equal(result.carryforwardCents, usd(7000));
    assert.equal(result.ordinaryBaseCents, usd(47000));
});

test('the net investment income surtax applies above its threshold', () => {
    const result = estimateTax({
        ordinaryIncomeCents: usd(250000),
        longTermGainCents: usd(50000),
        filingStatus: FILING_STATUS.SINGLE,
        year: 2024,
    });

    // 3.8% of the 50,000 of investment income, all of it above the 200,000 threshold.
    assert.equal(result.niitCents, usd(1900));
});

test('the surtax does not apply below the threshold', () => {
    const result = estimateTax({ ordinaryIncomeCents: usd(50000), longTermGainCents: usd(10000), year: 2024 });
    assert.equal(result.niitCents, 0n);
});

test('the estimate reports its own provenance', () => {
    const result = estimateTax({ ordinaryIncomeCents: usd(50000), year: 2024 });

    assert.equal(result.year, 2024);
    assert.match(result.source, /Rev\. Proc\./);
    assert.equal(result.verified, false, 'shipped tables are explicitly unverified');
});

test('an unknown year is refused rather than silently substituted', () => {
    assert.throws(() => estimateTax({ year: 1999 }), /No tax table for 1999/);
    assert.throws(() => ordinaryIncomeTax(usd(1000), 'martian'), /Unknown filing status/);
});

test('the legacy dollar wrapper still works', () => {
    assert.equal(calculateTax(10000, 'single', 2024), 1000);
    assert.equal(calculateTax(20000, 'single', 2024), 2168);
    assert.ok(calculateTax(50000, 'married_joint', 2024) < calculateTax(50000, 'single', 2024));
});

test('rates render readably', () => {
    assert.equal(formatRateBp(2200), '22%');
    assert.equal(formatRateBp(0), '0%');
    assert.equal(formatRateBp(380), '3.8%');
});
