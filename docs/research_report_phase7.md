# Research Report: Phase 7 (Long Term Roadmap)

## Objective
Enhance BitTax with "Long Term" advanced features: **Privacy Mixer Detection** and **Lightning Network Reconciliation**.

## 1. Privacy Mixer Detection (CoinJoin)

### Problem
Transactions involving mixing services (like Wasabi, Samourai/Whirlpool) obscure the flow of funds.
- **IRS Implication**: These transactions may be flagged as "High Risk" or require specific manual substantiation.
- **Audit Tool Goal**: Automatically flag these transactions so the user is aware they need to provide deeper proof of funds if audited.

### Detection Heuristics (Local Only)
Since we are using XPUBs and not a full graph analysis node, we must rely on heuristic patterns visible in the transaction data:
1.  **High Input/Output Count**: CoinJoins typically have many inputs vs many outputs (e.g., 50 inputs -> 50 outputs).
2.  **Equal Output Amounts**: The hallmark of a CoinJoin is multiple outputs with the exact same denomination (e.g., 0.1 BTC).

### Implementation Strategy
Refactor `AuditService.js` to inspect each transaction:
```javascript
function detectCoinJoin(tx) {
    if (tx.inputs.length > 5 && tx.outputs.length > 5) {
        // Check for equal output amounts
        const amounts = tx.outputs.map(o => o.value);
        const uniqueAmounts = new Set(amounts);
        // If 50 outputs but only 2 unique amounts (the mix amount + change), it's likely a mix.
        if (uniqueAmounts.size < 5) return true;
    }
    return false;
}
```

## 2. Lightning Network (LN) Reconciliation

### Problem
LN transactions happen off-chain. An XPUB only sees:
1.  **Channel Open**: On-chain tx sent to a 2-of-2 Multisig address.
2.  **Channel Close**: On-chain tx returning funds (minus net spend).

### The Gap
The "Net Spend" between Open and Close is a black box to the blockchain. It could be 1,000 coffee purchases.
- **Tax Implication**: Every coffee purchase is a taxable disposal.
- **Audit Tool Goal**: Flag "Channel Activities" and ask the user to upload a separate LN Export (e.g., from Phoenix/Breez) to fill the gap.

### implementation Strategy
1.  **Stub Logic**: Identify potential Channel Opens (sending to P2WSH addresses).
2.  **UI Flag**: Label these as "Potential Lightning Channel".
3.  **Future**: Allow CSV import of LN logs to reconcile the difference.

## Conclusion
For Phase 7, we will implement the **CoinJoin Detector** as a concrete logic addition and add the **Channel Stub** as a UI indicator.
