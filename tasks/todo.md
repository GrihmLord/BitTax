# BitTax — Gap / Stub / Leak Remediation

Audit date: 2026-08-22. Branch: agent/a10-secret-scanning.

## Findings (all verified against the code, not assumed)

### Leaks / security

- [x] L1  `main.js` `nodeIntegration:true` + `contextIsolation:false` — renderer had full Node.
- [x] L2  No CSP, no sandbox, no navigation guard, no network policy.
- [x] L3  DevTools wired into the production menu.
- [x] L4  XSS: UTXO labels / tx notes interpolated into `innerHTML` **and** into inline
          `onblur="saveLabel('${id}',...)"` strings. Chained with L1 to full RCE from a text box.
- [x] L5  CSV formula injection + no RFC4180 quoting.
- [x] L6  `.gitignore` did not cover exports, the vault, or `.env`.
- [x] L7  `BitcoinService` silently called CoinGecko in an "offline first" product.

### Gaps / stubs

- [x] G1  `deriveAddressesFromXpub` returned hardcoded fake addresses; validation was `startsWith('xpub')`.
- [x] G2  `calculateCapitalGains` ignored its `method` arg. `verify_audit.mjs` printed [FAIL]
          for HIFO and exited 0 anyway.
- [x] G3  Wash sale matched the sold lot against itself, ignored replacement quantity, used a
          30- not 61-day window, and deleted the loss instead of deferring it into basis.
- [x] G4  No short/long term split anywhere, though the README claimed it.
- [x] G5  `dateAcquired` never populated — CSV column was always `N/A`.
- [x] G6  CSV wash-sale column emitted `true` / `"No"`.
- [x] G7  Tax estimate hardcoded `* 0.22`; brackets unused, one year, two filing statuses,
          no long-term capital gains rates.
- [x] G8  Float money math end to end.
- [x] G9  Lot ids embedded the live inventory index — collided and re-bound as lots were consumed.
- [x] G10 `toggleFreeze` re-ran via `runAudit(true)`, swapping the user's data for demo data.
- [x] G11 Frozen UTXOs were cosmetic and still selected for cost basis.
- [x] G12 Zero persistence.
- [x] G13 Divide-by-zero → `NaN%` in the dashboard.
- [x] G14 `detectCoinJoin` keyed a map on float values; Lightning check was a naive length test.
- [x] G15 `npm test` dead: `setupFiles` pointed at a file that does not exist.
- [x] G16 `redux-logger` imported, never declared in package.json.
- [x] G17 `utils/api.js` and `utils/helpers.js` were duplicate mocks in production source.
- [x] G18 `App.js` imported `./src/navigation/AppNavigator` (directory is `Navigation`);
          `logErrorToMyService` was an empty stub.
- [x] G19 Calculation logic duplicated across three files and already diverged.

### Found during implementation (not in the original sweep)

- [x] G20 `redux/actions/index.js` imported `./actionTypes` — path does not exist.
- [x] G21 `redux/reducers/index.js` had the same broken `./actionTypes` path.
- [x] G22 `actionTypes.js` was missing four of the five constants `actions/index.js` imported,
          so those actions dispatched with `type: undefined`.
- [x] G23 `utils/api.js` had no `loginUser`, but `actions/index.js` called it.
- [x] G24 `gui_demo.html` carried a third copy of the 2024 brackets, missing the 35% and 37%
          bands, so it under-reported tax above $243,725.

## Plan

- [x] P0 Hygiene: jest config repaired, missing dep removed, duplicate mocks collapsed, `.gitignore` tightened.
- [x] P1 Single canonical core in `src/core/` — BigInt money, real FIFO/LIFO/HIFO,
         wash sale with basis deferral, holding-period split, 8949 rows.
- [x] P2 Real BIP32/SLIP-132 parse: Base58Check + checksum + version bytes + depth rule.
- [x] P3 Electron hardening: contextIsolation, sandbox, preload bridge, `app://` scheme,
         CSP header, network kill switch, navigation/window guards, prod devtools off.
- [x] P4 New renderer, zero `innerHTML` on user data, zero inline handlers, safe CSV via IPC.
- [x] P5 Stable lot ids, freeze actually excludes, encrypted vault, real tax rates, NaN guards.
- [x] P6 Tests for every core module, CI running them, docs/CHANGELOG updated.
- [x] P7 (added) CSV history import — the tool previously had no way to audit real data at all.

## Second pass — self-review of the untested code, and the RN stubs

Found by reading back what I had just written, since I could not run it:

- [x] R1  `pruneOrphans` deleted saved labels for any asset absent from the current audit.
          Importing a BTC-only CSV silently wiped every ETH label from the encrypted vault.
- [x] R2  Only assets that still had a history were re-audited, so a replaced history left a
          stale result on the dashboard.
- [x] R3  An export IPC rejection was unhandled; a startup failure left a dead-but-normal-looking UI.
- [x] R4  Clicking the Notices tab's count badge did nothing (`event.target` was the badge).

Remaining stubs in the React Native tree, all now closed:

- [x] R5  `LoginScreen` accepted any non-empty username/password as authentication, linked to two
          unregistered routes, and had an empty `StyleSheet.create({})`.
- [x] R6  `PaymentScreen` displayed "Payment Successful — You have paid {amount} BTC towards your
          taxes" next to `// Here you would integrate with your payment API`.
- [x] R7  `HomeScreen`'s "Pay $500 to IRS" / "Withdraw Bitcoin" decremented Redux and reported success.
- [x] R8  `SettingsScreen` navigated to three unregistered routes; its logout was a comment.
- [x] R9  `AuditScreen` displayed invented balances from the placeholder addresses.
- [x] R10 `@react-navigation/stack` + four peers imported but never declared — RN app could not start.
- [x] R11 `App.tsx` and `App.js` competed as entry points; the `.tsx` was the Expo template.
- [x] R12 `taxSlice.taxDebt` / `payTax` modelled a balance the fake IRS payment decremented.

## Third pass — address derivation

Implemented after the concern was raised and overruled. The concern was
specifically that unverifiable crypto could show wrong addresses; the design
answers that rather than ignoring it.

- [x] D1 `src/core/secp256k1.js` — affine point arithmetic in BigInt. No hash constants.
- [x] D2 `src/core/bech32.js` — BIP173 and BIP350.
- [x] D3 `src/core/bip32.js` — CKDpub, hardened indices structurally impossible.
- [x] D4 `src/core/addresses.js` — P2PKH, P2SH-P2WPKH, P2WPKH, mainnet and testnet.
- [x] D5 `src/main/derive.mjs` — supplies HMAC-SHA512 and RIPEMD-160 from `node:crypto`,
         so the SHA-512 round constants and RIPEMD-160 tables never had to be reproduced.
- [x] D6 Fail-closed self-test. Curve checks are group identities, not remembered values:
         G on curve, G+G=2G, 2G+3G=5G, (n-1)G=-G, (n-1)G+G=infinity, compression
         round-trip, off-curve rejection. Plus bech32 vs BIP173, Base58Check vs the
         genesis address, and CKDpub vs BIP32 test vector 1 end to end.
- [x] D7 IPC channels, preload surface, and an Addresses tab.

The one memorised input is the pair of BIP32 xpub strings in `derive.mjs`. If they
are wrong, the self-test fails and derivation disables itself with a message naming
the check — recoverable by correcting one constant, and safe in the meantime.

## Review

### What shipped

New: `src/core/` (14 modules), `src/main/` (ipc, vault), `renderer/` (6 files), `preload.js`,
`src/core/__tests__/` (11 suites), `.github/workflows/ci.yml`, `CHANGELOG.md`.
Rewritten: `main.js`, all four `src/services/*`, both verify scripts, `package.json`,
`.gitignore`, `README.md`, both demo HTML files.

### The two decisions worth challenging

1. **`deriveAddressesFromXpub` now throws instead of returning addresses.** Real derivation
   needs secp256k1 point arithmetic plus per-script address encoding — several hundred lines
   of from-scratch cryptography. Shipping that unverified would put wrong addresses in front
   of someone auditing their own cold storage. Returning two hardcoded placeholders, which is
   what it did, is worse than refusing. Validation *is* fully implemented. Tracked as Phase 10.

2. **The wash sale rule stays on by default but is now a visible toggle.** Section 1091 is
   written for "stocks or securities"; digital assets are generally treated as property, so
   applying it unconditionally — as the old code did — can overstate a user's income. Default
   behaviour is preserved; the choice is now explicit and documented.

### Not done, and why

- **Nothing was executed, and the build was never run.** A session-level safety classifier
  blocked every Bash, PowerShell, WebSearch and WebFetch call after the research phase. No
  test, lint or `electron-builder` run happened. `npm test` needs no `npm install` — it is
  the first thing to run.
- **Branch cleanup and the build could not be run.** Every git write (`git add` and beyond),
  `npm` and `node` are blocked. The exact sequence is in `tasks/finish.md` and the commit
  message is in `tasks/commit-message.txt`.
- **Address derivation is implemented but unexecuted.** The fail-closed self-test is the
  mitigation: a wrong implementation disables the feature instead of showing addresses.
  `npm test` is the first thing to run.
- **Rate tables ship `verified: false`.** Entered from the relevant revenue procedures but
  not checkable against a source here, so the data carries a provenance flag and the app
  raises a notice rather than presenting them as filing-ready.
- **`src/components/` (4 files) is unreferenced by any screen.** Dead, unreachable, so not
  rewritten. `TaxInfo` still models a `paymentStatus` the app no longer has.
- **`README.md.tmp.53240.7d806fba643a`** is a stray temp file in the repo root. Left in place
  because file deletion was unavailable; safe to remove.
- **`package-lock.json` is stale.** Five navigation dependencies are newly declared. Run
  `npm install` once; CI no longer uses `npm ci`.

### Verification checklist for the next session

```bash
npm test        # 11 core suites + 2 service suites, no install required
npm run verify  # smoke checks, now exit non-zero on failure
npm run electron
```

In the app: load the demo profile, switch FIFO/LIFO/HIFO and confirm the numbers move,
freeze a lot and confirm selection changes, type `=1+1` into a label and confirm the export
escapes it, paste an `xprv` and confirm it is refused.

Then the build, which was never run here:

```bash
npm install     # regenerates the lockfile with the five new navigation deps
npm run dist    # electron-builder -> dist/BitTax Audit-1.1.0-win.exe
```

If `npm run dist` fails, the likely causes in order: `assets/icon.png` below the 256x256
electron-builder requires; the `files` allowlist in `package.json` missing something the
main process loads at runtime; or a native rebuild triggered by the newly declared
`react-native-*` packages, which the desktop bundle does not need — they are Expo-only, so
`--config.files` can exclude them if that happens.
