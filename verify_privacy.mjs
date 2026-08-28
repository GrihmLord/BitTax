/**
 * verify_privacy.mjs
 * Smoke check for the privacy heuristics. Exits non-zero on failure.
 *
 * The exhaustive suite lives in `src/core/__tests__/privacy.test.js`.
 */

import { analyzeCoinJoin, analyzeLightningChannel } from './src/core/privacy.js';

const P2WSH = 'bc1qrp33g0q5c5txsp9dysjy386pxqry4y6k9k0q5k2k0q5k2k0q5k2k0q5k2k';
const P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const cases = [
    {
        name: 'Ordinary two-party payment',
        tx: { inputs: [{}, {}], outputs: [{ value: 0.5 }, { value: 0.1 }] },
        coinjoin: false,
        lightning: false,
    },
    {
        name: 'CoinJoin with uniform outputs',
        tx: {
            inputs: [{}, {}, {}, {}, {}],
            outputs: [{ value: 0.1 }, { value: 0.1 }, { value: 0.1 }, { value: 0.1 }, { value: 0.0432 }],
        },
        coinjoin: true,
        lightning: false,
    },
    {
        name: 'Lightning channel funding',
        tx: {
            inputs: [{ value: 1.0 }],
            outputs: [{ address: P2WSH, value: 0.5 }, { address: P2WPKH, value: 0.499 }],
        },
        coinjoin: false,
        lightning: true,
    },
    {
        name: 'Crowded transaction with no uniform amount',
        tx: {
            inputs: [{}, {}, {}, {}, {}],
            outputs: [{ value: 0.1 }, { value: 0.2 }, { value: 0.3 }, { value: 0.4 }, { value: 0.5 }],
        },
        coinjoin: false,
        lightning: false,
    },
];

console.log('--- Verifying privacy heuristics ---');

let failures = 0;

for (const { name, tx, coinjoin, lightning } of cases) {
    const cj = analyzeCoinJoin(tx);
    const ln = analyzeLightningChannel(tx);
    const passed = cj.isCoinJoin === coinjoin && ln.isLightning === lightning;
    if (!passed) failures += 1;

    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`);
    console.log(`        coinjoin=${cj.isCoinJoin} (${cj.confidence}) — ${cj.reason}`);
    console.log(`        lightning=${ln.isLightning} (${ln.confidence}) — ${ln.reason}`);
}

console.log(`\n${cases.length - failures}/${cases.length} passed.`);

if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
}
