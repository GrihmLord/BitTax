/**
 * verify_audit.mjs
 * Smoke check for the capital gains engine.
 *
 * This script previously reported "[FAIL]" for the HIFO case and still exited
 * 0, so CI and the commit log both showed green. It now exits non-zero on any
 * failure. The exhaustive suite lives in `src/core/__tests__`; run `npm test`.
 */

import { calculateGains } from './src/core/gains.js';
import { formatUSD } from './src/core/money.js';

/** Expected figures are written in dollars; the engine reports integer cents. */
const cents = (dollars) => BigInt(Math.round(dollars * 100));

const cases = [
    {
        name: 'Simple FIFO',
        method: 'FIFO',
        history: [
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 20000 },
            { type: 'SELL', date: '2023-06-01', amount: 0.5, price: 30000 },
        ],
        expected: 5000,
    },
    {
        name: 'Fees folded into basis and proceeds',
        method: 'FIFO',
        history: [
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 10000, fee: 50 },
            { type: 'SELL', date: '2023-06-01', amount: 1.0, price: 20000, fee: 50 },
        ],
        expected: 9900,
    },
    {
        name: 'Wash sale: loss deferred into the replacement lot',
        method: 'FIFO',
        history: [
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 50000 },
            { type: 'SELL', date: '2023-02-01', amount: 1.0, price: 40000 },
            { type: 'BUY', date: '2023-02-15', amount: 1.0, price: 42000 },
        ],
        expected: 0,
    },
    {
        name: 'HIFO selects the highest cost lot',
        method: 'HIFO',
        history: [
            { type: 'BUY', date: '2023-02-01', amount: 1.0, price: 50000 },
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 10000 },
            { type: 'SELL', date: '2023-03-01', amount: 1.0, price: 30000 },
        ],
        expected: -20000,
    },
    {
        name: 'LIFO selects the newest lot',
        method: 'LIFO',
        history: [
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 10000 },
            { type: 'BUY', date: '2023-02-01', amount: 1.0, price: 50000 },
            { type: 'SELL', date: '2023-03-01', amount: 1.0, price: 30000 },
        ],
        expected: -20000,
    },
];

console.log('--- Verifying capital gains engine ---');

let failures = 0;

for (const { name, method, history, expected } of cases) {
    const { summary } = calculateGains(history, { method, asset: 'BTC' });

    // Exact comparison: both sides are integer cents, so there is no tolerance
    // to set and no rounding to argue about.
    const expectedCents = cents(expected);
    const passed = summary.netGainCents === expectedCents;
    if (!passed) failures += 1;

    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} [${method}]`);
    if (!passed) {
        console.log(`        expected ${formatUSD(expectedCents)}, got ${formatUSD(summary.netGainCents)}`);
    }
}

console.log(`\n${cases.length - failures}/${cases.length} passed.`);

if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
}
