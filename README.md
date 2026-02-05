# BitTax: Cold Storage Audit Tool (Desktop)

**BitTax** is a privacy-focused, local-first desktop application designed to audit cryptocurrency cold storage wallets for tax compliance and verification.

> [!WARNING]
> **Public Repository Safety Notice**: This is an open-source tool.
> *   **Do NOT commit your real XPUBs or Private Keys** to any file in this repository.
> *   The "Demo Profile" uses completely mock data.
> *   All processing happens locally on your machine. Your keys are never sent to any external server.

## 🚀 Features

### 🛡️ Local & Private
*   **Offline First**: Designed to run without internet for maximum security.
*   **Non-Custodial**: You retain full control. No generic "cloud account" required.
*   **XPUB Audit**: Audits based on Extended Public Keys (XPUB), ensuring your Private Keys remain offline.

### 💰 Advanced Tax Logic
*   **Capital Gains**: Automatically calculates Short/Long term gains.
*   **Cost Basis Methods**:
    *   **FIFO** (First In, First Out) - Default/IRS Standard.
    *   **LIFO** (Last In, First Out).
    *   **HIFO** (Highest In, First Out) - Best for tax minimization.
*   **Wash Sale Detection**: Automatically flags and disallows losses if assets are repurchased within 30 days (IRS 30-day rule).

### 🛡️ Personal Audit Suite (New)
*   **Portfolio Dashboard**: Real-time view of Net Worth, Unrealized Gains (ROI), and Asset Allocation.
*   **UTXO Manager (Coin Control)**:
    *   **Visualize**: See every unspent chunk of Bitcoin you own.
    *   **Freeze**: "Lock" specific UTXOs to prevent them from being spent (simulated privacy protection).
    *   **Label**: Add notes to specific UTXOs (e.g., "KYC-Free", "Do Not Spend").
*   **Transaction Labeling**: Annotate your history with persistent notes (e.g., "Gift", "Mining").

### 📊 Multi-Asset Support
*   **Bitcoin (BTC)**: Full UTXO audit support.
*   **Ethereum (ETH)**: Account-based model support.
*   **Privacy Detections**:
    *   **CoinJoin/Mixers**: Flags transactions with high anonymity sets.
    *   **Lightning Network**: Detects potential off-chain channel opens.

### 📂 Reporting
*   **CSV Export**: Generates `bittax_audit_8949.csv` formatted for IRS Form 8949 / Tax Software import.

## 🛠️Tech Stack

*   **Runtime**: Electron (Windows/Mac/Linux)
*   **Frontend**: HTML5, CSS3 (Vanilla), JavaScript
*   **Architecture**: Local-First, Zero-Dependency Core Logic

## � Installation & Usage

### 1. Run from Source
```bash
# Install dependencies
npm install

# Run Desktop App
npm run electron
```

### 2. Build Installer (Windows)
```bash
npm run dist
```
This will generate a `.exe` installer in the `dist/` folder.

## 🧪 Verification
The most effective way to verify the logic is using the **Desktop App's Demo Mode**:

1.  Run `npm run electron`
2.  Click **"Running a test? Load Demo Profile"** at the bottom.
3.  Explore the **Dashboard**, **Audit**, and **UTXO Manager** tabs.
4.  Verify calculations (FIFO/LIFO/HIFO), Wash Sales, and Privacy Flags against the provided Mock Data.

***

**Disclaimer**: This software is for educational and informational purposes only. It does not constitute professional tax advice. Consult a CPA for your specific situation.
