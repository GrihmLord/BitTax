import { calculateCapitalGains } from './AuditService';

describe('AuditService', () => {
    describe('calculateCapitalGains (FIFO)', () => {
        it('should calculate gain correctly for simple buy/sell', () => {
            const history = [
                { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 20000 },
                { type: 'SELL', date: '2023-06-01', amount: 0.5, price: 30000 }
            ];
            // Cost Basis: 0.5 * 20000 = 10000
            // Proceeds: 0.5 * 30000 = 15000
            // Gain: 5000
            const { report, totalGain } = calculateCapitalGains(history);
            expect(totalGain).toBe(5000);
            expect(report[0].gain).toBe(5000);
        });

        it('should handle multiple buys (FIFO)', () => {
            const history = [
                { type: 'BUY', date: '2023-01-01', amount: 1.0, price: 10000 }, // Lot A
                { type: 'BUY', date: '2023-02-01', amount: 1.0, price: 20000 }, // Lot B
                { type: 'SELL', date: '2023-03-01', amount: 1.5, price: 30000 } // Sells all Lot A + 0.5 Lot B
            ];
            // Lot A: 1.0 * (30000 - 10000) = 20000 Gain
            // Lot B: 0.5 * (30000 - 20000) = 5000 Gain
            // Total: 25000
            const { totalGain } = calculateCapitalGains(history);
            expect(totalGain).toBe(25000);
        });
    });
});
