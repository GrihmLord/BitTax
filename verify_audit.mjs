import { calculateCapitalGains } from './src/services/AuditService.js';

console.log('--- Verifying Audit Logic (FIFO + Fees) ---');

const testCases = [
    {
        name: 'Simple FIFO',
        history: [
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 20000 },
            { type: 'SELL', date: '2023-06-01', amount: 0.5, price: 30000 }
        ],
        expectedGain: 5000
    },
    {
        name: 'Fees Included',
        history: [
            // Buy 1.0 @ 10k + $50 fee. Cost Basis = 10050.
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 10000, fee: 50 },
            // Sell 1.0 @ 20k - $50 fee. Proceeds = 19950.
            { type: 'SELL', date: '2023-06-01', amount: 1.0, price: 20000, fee: 50 }
        ],
        // Gain = Proceeds (19950) - Basis (10050) = 9900
        expectedGain: 9900
    },
    {
        name: 'Wash Sale (Loss Disallowed)',
        history: [
            // Buy 1.0 @ 50k
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 50000 },
            // Sell 1.0 @ 40k (Loss of 10k)
            { type: 'SELL', date: '2023-02-01', amount: 1.0, price: 40000 },
            // Buy 1.0 @ 42k (Within 30 days of sale -> Triggers Wash Sale)
            { type: 'BUY', date: '2023-02-15', amount: 1.0, price: 42000 }
        ],
        // The 10k loss should be disallowed (0 gain recorded for the sell).
        // The 10k loss should be disallowed (0 gain recorded for the sell).
        expectedGain: 0
    },
    {
        name: 'HIFO Strategy (High Price In First Out)',
        history: [
            // Buy A: 1.0 @ 50k (Newest, Highest Price)
            { type: 'BUY', date: '2023-02-01', amount: 1.0, price: 50000 },
            // Buy B: 1.0 @ 10k (Oldest, Lowest Price)
            { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 10000 },

            // Sell 1.0 @ 30k
            // FIFO would sell Buy B (10k cost) -> Gain = 20k
            // HIFO should sell Buy A (50k cost) -> Loss = 20k
            { type: 'SELL', date: '2023-03-01', amount: 1.0, price: 30000 }
        ],
        expectedGain: -20000 // Loss of 20k expected with HIFO
    }
];

testCases.forEach(({ name, history, expectedGain }) => {
    // If name contains 'HIFO', use that method
    const method = name.includes('HIFO') ? 'HIFO' : 'FIFO';
    const { totalGain } = calculateCapitalGains(history, method);

    console.log(`Test: ${name} [${method}]`);
    console.log(`  Expected Gain: $${expectedGain}`);
    console.log(`  Actual Gain:   $${totalGain}`);

    if (Math.abs(totalGain - expectedGain) < 0.01) {
        console.log('  [PASS]');
    } else {
        console.log('  [FAIL]');
    }
    console.log('---');
});
