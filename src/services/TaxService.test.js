import { calculateTax } from './TaxService';

describe('TaxService', () => {
    describe('calculateTax (Single)', () => {
        it('should calculate tax for 10% bracket', () => {
            // 10,000 * 0.10 = 1,000
            expect(calculateTax(10000)).toBe(1000);
        });

        it('should calculate tax for 12% bracket', () => {
            // 11,600 * 0.10 = 1,160
            // (20,000 - 11,600) * 0.12 = 8,400 * 0.12 = 1,008
            // Total = 2,168
            expect(calculateTax(20000)).toBe(2168);
        });

        it('should calculate tax for high income', () => {
            // Test a larger number to hit multiple brackets
            // Just verifying it runs and produces a plausible number greater than lower brackets
            const tax = calculateTax(100000);
            expect(tax).toBeGreaterThan(15000);
        });
    });

    describe('calculateTax (Married Joint)', () => {
        it('should calculate lower tax for same income compared to single', () => {
            const singleTax = calculateTax(50000, 'single');
            const marriedTax = calculateTax(50000, 'married_joint');
            expect(marriedTax).toBeLessThan(singleTax);
        });
    });
});
