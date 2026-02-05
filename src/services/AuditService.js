/**
 * AuditService.js
 * Logic for XPUB derivation (mocked) and Cost Basis Calculation (FIFO).
 */

// import { convertBtcToUsd } from './BitcoinService'; // Mocked for standalone verification
const convertBtcToUsd = (btc, price) => btc * price;

// Mock function to simulate deriving addresses from an XPUB
// In a real app, strict BIP32 lib would be used here.
export const deriveAddressesFromXpub = (xpub) => {
    // Validate basic format (starts with xpub, ypub, zpub)
    if (!xpub || !['xpub', 'ypub', 'zpub'].some(prefix => xpub.startsWith(prefix))) {
        throw new Error('Invalid XPUB format');
    }

    // Determine wallet type based on prefix for demo
    const type = xpub.startsWith('xpub') ? 'Legacy' : 'Segwit';

    // Return mock addresses that would belong to this wallet
    return [
        { address: 'bc1qxy...', balance: 0.5, transactions: 5 },
        { address: 'bc1qab...', balance: 1.2, transactions: 2 },
        // In real app, we would scan gap limits here
    ];
};

/**
 * Calculates Capital Gains using FIFO method, including Transaction Fees and Wash Sale Logic.
 * 
 * Wash Sale Rule:
 * A loss is disallowed if "substantially identical" securities are purchased within 30 days before or after the sale.
 * The disallowed loss is added to the cost basis of the new "replacement" shares.
 * 
 * @param {Array} history - List of { type: 'BUY'|'SELL', date, amount, price, fee }
 */
export const calculateCapitalGains = (history) => {
    let inventory = []; // Queue for FIFO
    let report = [];
    let totalGain = 0;
    let replacementCandidates = []; // Buys that could trigger wash sales (30 day window)

    // Sort by date ascending
    const sortedHistory = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));

    // First pass: identify all buys as potential replacements
    const buys = sortedHistory.filter(tx => tx.type === 'BUY').map(tx => ({ ...tx, timestamp: new Date(tx.date).getTime() }));

    for (const tx of sortedHistory) {
        const fee = tx.fee || 0;

        if (tx.type === 'BUY') {
            const totalCost = (tx.amount * tx.price) + fee;
            let effectivePrice = totalCost / tx.amount;

            // Note: If this Buy was triggered as a replacement elsewhere, its basis might increase. 
            // We handle this simplistically here by checking if previous logic flagged it (complex in single loop).
            // For a robust implementation, we might need a more stateful tracking.
            // Simplified approach: Normal Buy logic first.

            inventory.push({
                amount: tx.amount,
                price: effectivePrice,
                date: tx.date,
                timestamp: new Date(tx.date).getTime()
            });

        } else if (tx.type === 'SELL') {
            let remainingToSell = tx.amount;
            const netSortProceeds = (tx.amount * tx.price) - fee;
            const netProceedsPerUnit = netSortProceeds / tx.amount;
            const saleTime = new Date(tx.date).getTime();

            while (remainingToSell > 0 && inventory.length > 0) {
                const batch = inventory[0]; // Peek first (FIFO)

                const amountFromBatch = Math.min(batch.amount, remainingToSell);
                const costBasis = amountFromBatch * batch.price;
                const proceeds = amountFromBatch * netProceedsPerUnit;
                let gain = proceeds - costBasis;
                let wasWashSale = false;

                // WASH SALE CHECK: If Gain is Negative (Loss)
                if (gain < 0) {
                    // Look for a Buy within +/- 30 days
                    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
                    const replacement = buys.find(buy => {
                        const timeDiff = Math.abs(buy.timestamp - saleTime);
                        return timeDiff <= thirtyDays && buy.timestamp !== batch.timestamp; // Don't match self? Actually batch.timestamp is acquisition date. 
                        // Wash sale is about REPLACEMENT shares.
                    });

                    if (replacement) {
                        // Disallow the loss
                        wasWashSale = true;
                        // In a full implementation, we add this loss to the replacement's basis.
                        // Here we just zero out the loss for reporting purposes to be properly conservative.
                        gain = 0;
                    }
                }

                report.push({
                    dateSold: tx.date,
                    dateAcquired: batch.date,
                    amount: amountFromBatch,
                    proceeds: parseFloat(proceeds.toFixed(2)),
                    costBasis: parseFloat(costBasis.toFixed(2)),
                    gain: parseFloat(gain.toFixed(2)),
                    washSale: wasWashSale ? 'YES' : ''
                });

                totalGain += gain;
                remainingToSell -= amountFromBatch;

                if (batch.amount > amountFromBatch) {
                    batch.amount -= amountFromBatch;
                } else {
                    inventory.shift();
                }
            }
        }
    }

    return { report, totalGain: parseFloat(totalGain.toFixed(2)) };
};
