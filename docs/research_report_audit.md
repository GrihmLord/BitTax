# Research Report: Cold Storage Audit & Desktop GUI

## 1. Desktop GUI Strategy
The user requested "a gui not a web browser". For an existing React Native codebase, the best options are:
*   **Electron**: Wraps the web version of the app in a standalone Chromium window. Fast to implement, cross-platform, looks like a native app.
*   **React Native for Windows (Microsoft)**: True native Windows app. Performance is better, but setup is complex and often requires ejected Expo workflow.
*   **Recommendation**: **Electron**. It fulfills the "standalone GUI" requirement immediately using the existing web-compatible code we fixed in Phase 2.

## 2. Cold Storage & Offline Wallets (Deep Research)
To audit "cold storage" (e.g., Ledger, Trezor, Paper Wallets) without exposing private keys, we must use **XPUB (Extended Public Keys)**.
*   **Mechanism**: An XPUB key allows generating all public addresses in a wallet but *cannot* spend funds.
*   **Implementation**:
    1.  User inputs XPUB string (zpub/xpub/ypub).
    2.  App derives child addresses (BIP32/BIP44 standard).
    3.  App queries Blockchain API (e.g., Blockchain.com, Blockcypher) for transactions on those addresses.

## 3. IRS Self-Reporting (Audit Page)
The user wants an **Audit Page**, not a transaction page.
*   **IRS Form 8949**: "Sales and Other Dispositions of Capital Assets".
*   **Required Data**:
    *   (a) Description of property (e.g., 1.5 BTC).
    *   (b) Date acquired (Buy Date).
    *   (c) Date sold or disposed (Sell Date).
    *   (d) Proceeds (Sales Price).
    *   (e) Cost or other basis (Original Cost + Fees).
    *   (h) Gain or (loss).
*   **Logic Needed**:
    *   **FIFO (First-In, First-Out)**: Identify which "coins" were sold to calculate the correct Cost Basis.
    *   **Cost Basis Calculation**: `(Sold Price - Buy Price) * Amount`.

## 4. Implementation Plan (Pivot)
1.  **New Service**: `AuditService.js` (derives addresses, aligns history).
2.  **New Screen**: `AuditScreen.js` (Input XPUB, View Table).
3.  **Removal**: Deprecate "Pay IRS" (users don't pay *from* the audit tool, they report *to* it).
