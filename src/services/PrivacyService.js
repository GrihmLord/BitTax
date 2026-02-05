/**
 * PrivacyService.js
 * Analyzes transaction patterns to detect privacy risks (Mixers) and Layer 2 activity (Lightning).
 */

/**
 * Detects if a transaction is likely a CoinJoin/Mixer.
 * Heuristic: High number of inputs/outputs with uniform output amounts.
 * @param {Object} tx - { inputs: [], outputs: [{ value: 0.1 }, ...] }
 * @returns {boolean}
 */
export const detectCoinJoin = (tx) => {
    // 1. Check counts. Mixers usually have many participants.
    if (!tx.inputs || !tx.outputs) return false;
    if (tx.inputs.length < 5 || tx.outputs.length < 5) return false;

    // 2. Check for Uniform Output Amounts (The hallmark of CoinJoin)
    // We count how many outputs are identical.
    const amounts = tx.outputs.map(o => o.value);

    // Count occurrences of each amount
    const counts = {};
    amounts.forEach(a => { counts[a] = (counts[a] || 0) + 1; });

    // If any single amount appears more than 3 times (simplified threshold), it's suspicious.
    // In a real CoinJoin of 50 people, the mix amount appears 50 times.
    const isUniform = Object.values(counts).some(count => count >= 3);

    return isUniform;
};

/**
 * Detects if a transaction is likely a Lightning Channel Open.
 * Heuristic: Funds sent to a P2WSH (Pay to Witness Script Hash) address (starts with bc1q... and is 62 chars or specific format).
 * Since we don't have full script data in this simple model, we check for 2-of-2 multisig indicators if available, 
 * or rely on a "type" stub if provided by upstream indexer.
 * 
 * For this implementation, we check if the OUTPUT is a 'multisig' type or P2WSH format.
 */
export const detectLightningChannel = (tx) => {
    // Check outputs for P2WSH characteristics
    // Real P2WSH address length is 62 chars (bc1q + 58 chars)
    if (!tx.outputs) return false;

    const hasP2WSH = tx.outputs.some(out => {
        return out.address && out.address.startsWith('bc1q') && out.address.length === 62;
    });

    return hasP2WSH;
};
