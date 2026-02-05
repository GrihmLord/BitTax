/**
 * TaxService.js
 * Logic for calculating US Federal Income Tax (2024 Brackets).
 */

const TAX_BRACKETS_2024 = {
    single: [
        { limit: 11600, rate: 0.10 },
        { limit: 47150, rate: 0.12 },
        { limit: 100525, rate: 0.22 },
        { limit: 191950, rate: 0.24 },
        { limit: 243725, rate: 0.32 },
        { limit: 609350, rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
    ],
    married_joint: [
        { limit: 23200, rate: 0.10 },
        { limit: 94300, rate: 0.12 },
        { limit: 201050, rate: 0.22 },
        { limit: 383900, rate: 0.24 },
        { limit: 487450, rate: 0.32 },
        { limit: 731200, rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
    ],
};

export const calculateTax = (income, filingStatus = 'single') => {
    const brackets = TAX_BRACKETS_2024[filingStatus] || TAX_BRACKETS_2024.single;
    let tax = 0;
    let previousLimit = 0;

    for (const bracket of brackets) {
        if (income > bracket.limit) {
            tax += (bracket.limit - previousLimit) * bracket.rate;
            previousLimit = bracket.limit;
        } else {
            tax += (income - previousLimit) * bracket.rate;
            break;
        }
    }

    return parseFloat(tax.toFixed(2));
};

export const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
};
