# Research Report: Phase 6 (Mid-Term Roadmap)

## Objective
Implement Multi-Asset Support (Ethereum) and Advanced Cost Basis Methods (HIFO/LIFO) to transform BitTax into a comprehensive audit solution.

## 1. Multi-Asset Architecture

### Problem
The current Redux implementation (`cryptoSlice.js`) is Bitcoin-centric:
```javascript
initialState = {
  xpub: null,
  addresses: [],
  btcBalance: 0,
  bitcoinPrice: 0
}
```
This flat structure cannot support multiple chains.

### Solution: `wallet` Map
Refactor the state to use a normalized map keyed by asset ID:
```javascript
initialState = {
  activeAssetId: 'bitcoin', // 'bitcoin' | 'ethereum'
  prices: {
    bitcoin: 0,
    ethereum: 0
  },
  wallets: {
    bitcoin: {
      xpub: null,
      addresses: [],
      balance: 0
    },
    ethereum: {
      xpub: null, // Public Address for ETH
      addresses: [],
      balance: 0
    }
  }
}
```

### Ethereum Specifics
- **Model**: Account-based (Balance is on the address itself), not UTXO.
- **Derivation**: Typically we just import a single Public Address (0x...) rather than an XPUB for simple auditing, although HD Control is possible.
- **Impact**: The `AuditService` needs a `derive` function that simply returns the single ETH address if the input starts with '0x'.

## 2. Advanced Cost Basis Methods

### Current: FIFO
- **Logic**: Sorts Inventory by `Date Ascending`. Consumes oldest lots first.
- **Pros**: IRS standard.
- **Cons**: Can lead to higher taxes if oldest coins were cheap.

### Proposed: HIFO (Highest In, First Out) & LIFO
- **LIFO**: Sort Inventory by `Date Descending` (Newest first).
- **HIFO**: Sort Inventory by `Price Descending` (Most expensive first).
    - **Benefit**: Maximizes Cost Basis -> Minimizes Capital Gains -> Lowers Tax.

### Implementation Strategy
Refactor `calculateCapitalGains(history, method = 'FIFO')`:
1.  **Inventory Construction**: Same for all.
2.  **Sort Comparator**:
    - `FIFO`: `(a, b) => a.date - b.date`
    - `LIFO`: `(a, b) => b.date - a.date`
    - `HIFO`: `(a, b) => b.price - a.price`
    - `LOFO` (Lowest Cost): `(a, b) => a.price - b.price`

## 3. GUI Updates
- **Asset Toggle**: Tabs for [Bitcoin | Ethereum].
- **Algo Selector**: Dropdown for [FIFO | LIFO | HIFO].
- **Wash Sale Warn**: Logic applies identically regardless of asset (rules are IRS universal).

## Conclusion
The refactor is low-risk but high-value. We can achieve it by expanding the Redux slice and parameterizing the Audit Service.
