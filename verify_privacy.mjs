import { detectCoinJoin, detectLightningChannel } from './src/services/PrivacyService.js';

console.log('--- Verifying Privacy & Lightning Detection ---');

const testCases = [
    {
        name: 'Normal Transaction',
        tx: {
            inputs: [{}, {}], // 2 inputs
            outputs: [{ value: 0.5 }, { value: 0.1 }] // 2 outputs, different values
        },
        expectCoinJoin: false,
        expectLN: false
    },
    {
        name: 'CoinJoin (Whirlpool Style)',
        tx: {
            // 5 inputs, 5 outputs. 
            // 4 outputs are exactly 0.1 BTC (The mix). 1 is change.
            inputs: [{}, {}, {}, {}, {}],
            outputs: [
                { value: 0.1 }, { value: 0.1 }, { value: 0.1 }, { value: 0.1 },
                { value: 0.0432 } // Change
            ]
        },
        expectCoinJoin: true,
        expectLN: false
    },
    {
        name: 'Lightning Channel Open',
        tx: {
            inputs: [{ value: 1.0 }],
            outputs: [
                // P2WSH Address (62 chars)
                { address: 'bc1qrp33g0q5c5txsp9dysjy386pxqry4y6k9k0q5k2k0q5k2k0q5k2k0q5k2k', value: 0.5 },
                { address: 'bc1q_change...', value: 0.499 }
            ]
        },
        expectCoinJoin: false, // Inputs/Outputs too low
        expectLN: true
    }
];

testCases.forEach(({ name, tx, expectCoinJoin, expectLN }) => {
    const isCJ = detectCoinJoin(tx);
    const isLN = detectLightningChannel(tx);

    console.log(`Test: ${name}`);
    console.log(`  CoinJoin Detected: ${isCJ} (Expected: ${expectCoinJoin})`);
    console.log(`  Lightning Detected: ${isLN} (Expected: ${expectLN})`);

    if (isCJ === expectCoinJoin && isLN === expectLN) {
        console.log('  [PASS]');
    } else {
        console.log('  [FAIL]');
    }
    console.log('---');
});
