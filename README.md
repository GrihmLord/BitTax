# BitTax: Cold Storage Audit Tool (Desktop)

**BitTax** is a privacy-focused, local-first desktop application that audits self-custodied
cryptocurrency holdings and produces a Form 8949 style capital gains report.

> [!WARNING]
> **Never paste spending material into this or any audit tool.**
> BitTax needs only watch-only data. It actively detects and refuses extended private keys
> (`xprv`/`yprv`/`zprv`), WIF keys, raw 256-bit keys and BIP39 seed phrases. If you have
> already pasted one somewhere, treat it as compromised and move the funds.

<!-- Two separate GitHub alerts; the comment keeps them from merging. -->

> [!NOTE]
> This is an estimation and record-keeping tool, not tax advice, and not a filing service.
> The rate tables ship **unverified** — check them against the IRS revenue procedure for
> your year before you file. Consult a CPA.

## What it does

### Local and private, enforced rather than promised

- **Offline by construction.** The Electron session cancels every outbound request that is
  not the app's own `app://` scheme. There is no telemetry, no account, no sync.
- **Hardened renderer.** `contextIsolation`, `sandbox`, no Node integration, a strict
  Content-Security-Policy served as a real header, navigation and popups denied, DevTools
  excluded from packaged builds.
- **Watch-only.** Extended *public* keys are parsed and validated; private material is
  refused at the input boundary and never enters state, logs or persistence.
- **Encrypted at rest.** Your transaction history, labels, freezes and notes are stored
  through the OS keystore (DPAPI on Windows, Keychain on macOS, libsecret on Linux), so
  reopening BitTax lands on your numbers rather than an empty form. If no keystore is
  available, BitTax declines to write rather than saving anything in the clear. The demo
  profile never writes, and never overwrites what you have saved.

### Capital gains

- **Cost basis methods:** FIFO (IRS default), LIFO, HIFO.
- **Short and long term classification** per IRS holding-period rules, including the
  "more than one year" boundary and the 29 February roll.
- **Fees** are folded into basis on acquisition and netted from proceeds on disposal.
- **Wash sale treatment** (optional, on by default): matched by replacement quantity across
  the 61-day window, with the disallowed loss deferred into the replacement lot's basis and
  the holding period tacked — not simply deleted.
- **Exact arithmetic.** Every amount is an integer of base units — satoshi, wei, cent —
  held as a BigInt. No figure on a tax document is the result of binary floating point.

### Address derivation

- **Watch-only expansion.** An account-level `xpub`/`ypub`/`zpub` becomes the addresses your
  wallet would use — receive and change chains, any index range. Nothing derived here can spend.
- **Hardened indices are impossible**, not merely blocked: they require a private key, which
  BitTax never holds.
- **Self-tested before use.** secp256k1 arithmetic is checked against group identities, bech32
  against the BIP173 vector, Base58Check against the genesis address, and BIP32 CKDpub against
  BIP32 test vector 1. Any failure disables derivation instead of producing addresses.

### Coin control

- **UTXO manager.** See every open lot with its acquisition date, cost basis and value.
- **Freeze** a lot to hold it back from cost-basis selection. If a sale exhausts everything
  else and has to reach a frozen lot, you are told which one and when.
- **Label** lots and annotate transactions. Both are saved encrypted.

### Privacy heuristics

- **CoinJoin / mixer detection** from participant count and exact-satoshi output uniformity,
  reported with an anonymity set, a confidence level and a plain-language reason.
- **Lightning channel funding detection** from bech32 P2WSH output shape, mainnet and testnet.

### Import and export

- **Import** a transaction history CSV from a wallet or exchange. Column names are matched
  across common dialects; rows that cannot be read are reported by line number rather than
  dropped.
- **Export** a Form 8949 layout (with the `W` adjustment code and column (g) amount) or a
  full working paper including your labels and notes. Both are RFC 4180 correct and
  neutralise spreadsheet formula injection.

## Install and run

```bash
npm install          # only needed for the desktop shell (electron + electron-builder)
npm run electron     # run the desktop app
npm run electron:dev # same, with DevTools
npm run dist         # build a Windows installer into dist/
```

## Tests

The audit core has **no runtime dependencies**, so its tests need no install:

```bash
npm test        # the audit core, via the Node test runner
npm run verify  # smoke checks for the gains engine and privacy heuristics
npm run check   # both of the above, in order
```

`npm test` covers the money arithmetic, lot selection, wash sales, holding periods, tax
brackets, CSV writing, CSV import, Base58Check, SHA-256 (against the FIPS 180-4 vectors),
secp256k1 (against curve identities), bech32 (against BIP173), BIP32 CKDpub (against BIP32
test vector 1), extended key parsing, secret detection, and the IPC boundary.

To land a release — verify, build, commit, merge to `main` — there is one command:

```bash
bash scripts/finish.sh
```

It stops at the first failure and never merges unverified code. See
[`tasks/finish.md`](tasks/finish.md) for the manual sequence and what each failing suite means.

## Trying it out

1. `npm run electron`
2. Click **Running a test? Load demo profile** — a banner marks every figure as sample data.
3. Compare **FIFO / LIFO / HIFO**; the demo set contains a wash sale, a long-term disposal,
   a CoinJoin-flagged sale and a Lightning channel open.
4. Freeze a lot in **UTXO manager** and re-run to see selection change.
5. Check **Notices** for engine warnings.

To audit real holdings, use **Import history (CSV)** and enter a mark price per asset.

## Architecture

```text
main.js              Electron main: app:// scheme, CSP, network kill switch, window lockdown
preload.js           The entire privileged surface exposed to the renderer
src/main/            Main-process only: IPC validation, encrypted vault
src/core/            The audit engine. Pure, dependency-free, shared by every surface
renderer/            Desktop UI. No innerHTML on user data, no inline handlers
```

`src/core` is the single implementation of every calculation. Before this it existed in two
divergent copies plus a third partial copy of the tax brackets, and they had already drifted.

## Roadmap

### Completed

- [x] Cost basis engine: FIFO / LIFO / HIFO on exact integer arithmetic
- [x] IRS-style wash sale with basis deferral and holding-period tacking
- [x] Short / long term classification and Form 8949 export
- [x] Privacy heuristics with confidence and reasons
- [x] Local-first Electron shell, hardened
- [x] Portfolio dashboard, UTXO manager, labelling
- [x] Real BIP32 / SLIP-132 extended key validation
- [x] CSV history import
- [x] Encrypted local persistence
- [x] Test suite and CI that runs it
- [x] **Address derivation** — secp256k1, BIP32 CKDpub, bech32, and P2PKH / P2SH-P2WPKH /
      P2WPKH encoding, gated behind a self-test

### Next

- [ ] **Phase 10b — History fetching.** An Electrum or Esplora client behind an explicit,
      per-session network opt-in, to turn derived addresses into a transaction history
      automatically instead of importing a CSV.
- [ ] **Phase 11 — Verified rate tables.** Ship each year with `verified: true` and a test
      pinned to the published figures.
- [ ] **Phase 12 — PSBT construction** from the selected, unfrozen UTXO set.
- [x] **Phase 13 — Decided the fate of the React Native tree.** Removed. The desktop app is
      the product; the mobile prototype carried no automated coverage and duplicated
      surfaces that `src/core` already owns.

## Known limitations

- **Rate tables are unverified.** `src/core/taxTables.js` marks every year `verified: false`
  and the app raises a notice. Confirm against the IRS revenue procedure before filing.
- **Federal only.** No state tax, AMT, credits, phase-outs or prior-year carryforward input.
- **Wash sale applicability.** Section 1091 is written for "stocks or securities"; digital
  assets are generally treated as property, so this treatment is conservative rather than
  certain. It is a visible toggle — decide with your preparer.
- **Wash sale cascades** are resolved in one pass; a cascade that itself creates a new loss
  is not re-processed.
- **No chain lookup.** Addresses can be derived, but nothing fetches their history. Import a
  CSV for that.
- **Derivation refuses rather than guesses.** Curve arithmetic, bech32, Base58Check and an
  end-to-end BIP32 CKDpub vector are all checked before the first address is produced. If
  any check fails the feature disables itself and names the failing check, because a wrong
  address shown to someone auditing cold storage is worse than no address at all.
- **Multisig keys (`Ypub`/`Zpub`) cannot be expanded.** An address needs every cosigner's key.
- **Desktop only.** The React Native prototype was removed in this release; there is no
  mobile target.

***

**Disclaimer**: This software is for educational and informational purposes only. It does not
constitute tax, legal or financial advice. Verify every figure before filing.
