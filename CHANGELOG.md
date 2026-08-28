# Changelog

All notable changes to this project are documented here.

## [1.1.0] — 2026-08-22

A remediation pass over the whole tool: the security posture of the desktop
shell, the correctness of the tax engine, and the honesty of everything the UI
claims to know.

### Security

- **Renderer no longer has Node.** `main.js` ran with `nodeIntegration: true` and
  `contextIsolation: false`. It now runs with `contextIsolation`, `sandbox`,
  `nodeIntegration: false`, `webviewTag: false` and a fixed preload bridge.
- **Cross-site scripting removed.** The old UI built table rows with `innerHTML`
  from user-entered UTXO labels *and* interpolated those labels into inline
  `onblur="saveLabel('...')"` handlers. A label of `'); alert(1);//` executed,
  and with Node in the renderer that was remote code execution from a text box.
  All rendering now goes through `textContent` and `addEventListener`.
- **Content-Security-Policy.** Content is served over a custom `app://` scheme so
  a real CSP header can be attached: `default-src 'none'`, no inline script, no
  inline style, `connect-src 'none'`.
- **Network kill switch.** Every request that is not the app's own scheme is
  cancelled at the Electron session level, making the "offline first" claim
  enforced rather than promised. Permission requests are denied wholesale.
- **Navigation locked down.** `will-navigate` off-origin is blocked,
  `setWindowOpenHandler` denies every popup, webview attachment is prevented.
- **DevTools removed from packaged builds.** Available only under
  `npm run electron:dev`.
- **Path containment.** The `app://` handler serves only `renderer/` and
  `src/core/`; anything else returns 403 even if traversal reaches it.
- **CSV injection fixed.** Fields beginning `=`, `+`, `-`, `@`, tab or CR are
  prefixed so spreadsheets treat them as text, while genuine numbers and dates
  are left as values. Full RFC 4180 quoting means a label containing a comma no
  longer corrupts the export.
- **Spending-material screening.** Pasting an `xprv`, a WIF key, a raw 256-bit
  key or a BIP39 seed phrase is now detected, refused, kept out of state and
  persistence, and answered with what to do about it.
- **Encrypted persistence.** Labels and freezes are written through Electron's
  `safeStorage` (DPAPI / Keychain / libsecret). Where no OS keystore exists the
  vault refuses to write rather than falling back to plaintext.
- **IPC input validation.** Every channel bounds string lengths and entry counts;
  export filenames are reduced to a safe basename and the directory is always
  chosen by the user through a system dialog.
- **`.gitignore` covers user data.** Audit exports, the vault, `.env` and stray
  key files can no longer be committed by accident.
- **Price lookups are opt-in.** `BitcoinService` called CoinGecko on mount in a
  product that advertises it never contacts a server. It now throws unless the
  caller explicitly passes `allowNetwork: true`.

### Fixed

- **`calculateCapitalGains` ignored its `method` argument.** Every LIFO and HIFO
  request silently returned FIFO numbers. `verify_audit.mjs` printed `[FAIL]`
  for the HIFO case and still exited 0, so this shipped looking green.
- **Verifier scripts now exit non-zero on failure.**
- **Wash sale treatment rewritten.** It matched the lot being sold against
  itself, ignored how much replacement property was actually acquired, used a
  30-day rather than 61-day window, and *deleted* the disallowed loss instead of
  adding it to the replacement lot's basis — overstating income twice. It now
  matches by quantity, defers the loss into the replacement's basis (cascading
  onto a replacement that has already been sold), and tacks the holding period.
- **Short and long term classification added.** The README claimed it; nothing
  implemented it. Form 8949 cannot be filed without it.
- **`Date acquired` is populated.** The CSV hardcoded `N/A` in that column.
- **Wash sale column no longer emits `true` / `"No"`.**
- **Money maths moved off floating point.** Every amount is an integer of base
  units (satoshi, wei, cent) using BigInt. Splitting a lot can no longer strand
  or invent a cent.
- **Lot identity is stable.** Ids embedded the live inventory index
  (`utxo-${date}-${amount}-${inventory.length}`), so they collided and re-bound
  as inventory was consumed — freezing or labelling one UTXO could silently move
  to a different one.
- **Freezing a UTXO does something.** Frozen lots were purely cosmetic and were
  still selected for cost basis. They are now held back, reached only when
  nothing else remains, and that event is reported.
- **Freezing no longer swaps in demo data.** `toggleFreeze` re-ran the audit via
  `runAudit(true)`, forcing demo mode over the user's real history.
- **Overselling is reported.** A sale larger than recorded holdings silently
  dropped the excess. It is now reported at zero basis with a warning.
- **Divide-by-zero removed** from the dashboard allocation, which rendered
  `NaN%` on an empty portfolio.
- **CoinJoin detection no longer groups outputs by floating point value.**
- **Lightning detection** uses a real bech32 shape check and covers testnet.
- **`npm test` works.** Jest pointed `setupFiles` at `./path-to-setup-file.js`,
  which does not exist, so the whole suite refused to start.
- **`redux-logger` was imported but never declared** in `package.json`; the store
  crashed on any clean install. Replaced with a small dev-only middleware.
- **`App.js` imported `./src/navigation/AppNavigator`** where the directory is
  `Navigation`; this resolved only on case-insensitive filesystems.
- **`ErrorBoundary` called an empty `logErrorToMyService`,** so every caught
  render error vanished. It now logs locally and shows the message.
- **`redux/actions/index.js` imported `./actionTypes`,** a path that does not
  exist, and called `api.loginUser`, a function that was never written.
- **Tax estimate is no longer a flat 22%.** Short term gains stack as ordinary
  income, long term gains stack above them at preferential rates, the $3,000
  annual capital loss limit and carryforward are modelled, and the 3.8% net
  investment income surtax is applied above its threshold.

#### Second remediation pass

- **Saved labels were being deleted.** The renderer pruned annotations whose lot
  id was absent from the current audit, but only assets with a loaded history
  appear in the results — so importing a Bitcoin-only CSV silently wiped every
  saved Ethereum label from the encrypted vault. Pruning now removes only
  genuinely empty records; deliberate clearing is what "Forget saved labels" is
  for.
- **Stale results survived a re-import.** Only assets that still had a history
  were re-audited, so an asset whose history was replaced kept its previous
  result on the dashboard. Every supported asset is now re-audited.
- **An export IPC rejection went unhandled**, and a startup failure left a page
  that looked fine but responded to nothing. Both now surface.
- **Clicking the Notices tab's count badge did nothing** — the click landed on
  the badge, not the tab. Resolved with `closest('.tab')`.
- **Fake authentication removed.** `LoginScreen` accepted any non-empty username
  and password as a successful login. In a wallet tool that is security theatre
  that trains exactly the reflex a phishing page needs. It also linked to
  `ForgotPassword` and `SignUp`, neither of which is a registered route, so both
  crashed on tap, and its `StyleSheet.create({})` was an empty placeholder that
  left the screen unstyled.
- **`PaymentScreen` claimed to have paid your taxes.** Beside a comment reading
  `// Here you would integrate with your payment API`, it displayed "Payment
  Successful — You have paid {amount} BTC towards your taxes". No payment API
  existed and nothing was sent anywhere. Replaced with a screen that says BitTax
  cannot make payments, lists the real federal payment channels, and warns that
  anyone demanding tax payment in cryptocurrency is running a scam.
- **`HomeScreen`'s "Pay $500 to IRS" and "Withdraw Bitcoin" buttons** only
  decremented Redux state and then reported success. Both removed; the screen is
  now a read-only summary driven by the real engine.
- **`SettingsScreen` navigated to three unregistered routes** and had a "Log Out"
  handler that announced a logout beside `// Here you would clear the user's
  session/token`. Replaced with real settings — cost basis method, filing status,
  tax year, wash sale toggle — wired to the store the engine reads.
- **`AuditScreen` displayed invented balances** from the placeholder addresses
  `deriveAddressesFromXpub` used to return. It now validates the key for real and
  reports its script type, network, derivation purpose and fingerprint.
- **`@react-navigation/stack` was imported but never declared** in package.json,
  along with its four peer dependencies, so the React Native app could not start
  at all. Same class of defect as `redux-logger`.
- **`App.tsx` and `App.js` both existed** as entry points, and which one booted
  depended on Metro's resolver order. The `.tsx` file was still the untouched
  Expo template. It now re-exports the real entry point.
- **`taxSlice` modelled a `taxDebt` balance** that the fake IRS payment
  decremented. Removed.

### Added

- **`src/core/` — one audit engine.** The calculation previously existed in two
  divergent copies (`src/services/AuditService.js` and inline in
  `audit_demo.html`) plus a third partial copy of the tax brackets in
  `gui_demo.html`. There is now a single implementation that the desktop
  renderer, the React Native screens, the verifiers and the tests all share.
- **CSV history import.** The tool could only ever audit its own built-in sample
  data; there was no route for a real history to enter it. Imports from wallet
  and exchange exports, matching column names across dialects, reporting bad
  rows by line number rather than dropping them.
- **Real BIP32 / SLIP-132 extended key validation** — Base58Check with checksum
  verification, version byte recognition across `xpub`/`ypub`/`zpub` and their
  testnet and multisig variants, and the BIP32 depth-consistency rule. The
  previous check was `startsWith('xpub')`.
- **Dependency-free SHA-256**, verified against the FIPS 180-4 vectors and
  cross-checked against `node:crypto` across every padding boundary.
- **Four filing statuses and two tax years**, with each table carrying its source
  revenue procedure and a `verified` flag the UI surfaces.
- **A notices panel** that surfaces engine warnings, import errors and key
  validation results instead of discarding them.
- **Test suite** covering the engine, wash sales, holding periods, money maths,
  CSV writing, imports, key parsing and secret detection.
- **CI that runs the tests.** The only workflow was a secret scan; nothing ever
  executed a test.

#### Session persistence

- **The transaction history now survives closing the app.** Only labels, freezes
  and settings were saved, so every launch began by re-importing the CSV — in a
  tool people open once a year. The history and per-asset mark prices are now
  stored in the same encrypted vault, and a restored history is audited on
  startup so reopening lands on the numbers rather than an empty form.
- **The demo profile never writes.** Loading it would otherwise either save
  sample data as though it were real, or overwrite a real saved history with the
  empty one the demo replaced it with. `persist` refuses while the demo is
  loaded, and the banner says so.
- **"Forget saved labels" now clears everything**, history included, and resets
  the form rather than leaving stale fields behind.
- Persisted transactions are validated at the IPC boundary — bounded lengths,
  a 10,000 row cap, unknown assets and transaction types dropped. Amounts stay
  strings on the way to disk, because round-tripping `0.1` through a JSON number
  would reintroduce exactly the floating point error the engine exists to avoid.

#### Address derivation (third pass)

- **Implemented, and gated behind a self-test.** `deriveAddressesFromXpub` no longer refuses.
  New: `src/core/secp256k1.js` (affine curve arithmetic in BigInt), `src/core/bech32.js`
  (BIP173/BIP350), `src/core/bip32.js` (CKDpub), `src/core/addresses.js` (P2PKH,
  P2SH-P2WPKH, P2WPKH), and `src/main/derive.mjs`, which wires in `node:crypto` for
  HMAC-SHA512 and RIPEMD-160.
- **HMAC-SHA512 and RIPEMD-160 are not hand-written.** Derivation runs in the main process
  so `node:crypto` can supply them, which keeps the two largest sources of error — the
  SHA-512 round constants and the RIPEMD-160 word-order and rotation tables — out of code
  we would otherwise have to reproduce exactly. RIPEMD-160 is a legacy digest in OpenSSL 3
  and absent from some Node builds, so its availability is checked up front.
- **Nothing derives until the self-test passes.** secp256k1 is verified against group
  identities that hold by mathematics rather than by remembered constants — `G` on the
  curve, `G+G = 2G`, `2G+3G = 5G`, `(n-1)G = -G`, `(n-1)G + G = infinity`, compression
  round-trip, off-curve rejection. bech32 is checked against the BIP173 vector,
  Base58Check against the genesis address, and CKDpub end-to-end against BIP32 test
  vector 1 (m/0H to m/0H/1). Any failure disables derivation and names the failing check.
- **Hardened indices are refused** — they need a private key, which a watch-only tool
  never has. Multisig prefixes are refused too, since an address needs every cosigner.
- **Scans are capped** at 200 addresses so a bad count cannot hang the app.
- New `Addresses` tab, and two IPC channels (`derive:status`, `derive:addresses`) with the
  key length bounded at the boundary and validated downstream.

### Changed

- **Mark prices come from the user.** The dashboard hardcoded BTC at $45,000 and
  ETH at $2,500 and presented the results as portfolio value. Unpriced holdings
  now show as unpriced.
- **`deriveAddressesFromXpub` no longer invents addresses.** It returned two
  hardcoded placeholders indistinguishable from real output. It now derives them
  for real, taking `hmacSha512` and `hash160` as injected dependencies, and
  throws `MissingCryptoDependencyError` if a caller omits them rather than
  falling back to anything.
- **The wash sale rule is switchable.** Section 1091 is written for "stocks or
  securities", and digital assets are generally treated as property, so the
  treatment is conservative rather than certain. It stays on by default,
  preserving existing behaviour, but is now an explicit, documented choice.
- **`audit_demo.html` and `gui_demo.html` replaced with notices** pointing at
  `renderer/index.html`.
- **`build.npmRebuild` is off.** With an empty `dependencies` and `node_modules`
  excluded from the bundle, there is never a native module to rebuild against
  Electron's ABI, so the default only bought a full walk of the dependency tree
  before every build. The explanatory note for it lives at the top level of
  `package.json`, not inside `build`: electron-builder validates the `build`
  object against a strict schema and aborts on any unknown property, `"//"`
  comment keys included.

### Known limitations

- The rate tables ship with `verified: false`. Confirm them against the IRS
  revenue procedure for your year before filing; the UI raises a notice.
- Network history fetching is not implemented (Phase 10b). Addresses can be
  derived, but nothing looks up their transactions; import a CSV for that.
- Derivation was written but never executed in the session that produced it.
  The self-test is the safety net: if the implementation is wrong, the feature
  disables itself rather than showing addresses. Run `npm test` first.
- Wash sale basis cascades are resolved in a single pass; a cascade that itself
  creates a new loss is not re-processed.
- The React Native tree under `src/screens` is a secondary target. Its fake
  authentication, fabricated payments and unregistered routes are gone and its
  screens are wired to the real engine, but the desktop app is the primary
  product and the mobile tree has no automated coverage beyond `LoginScreen`.
- `src/components/{Button,InputField,TaxInfo,WalletInfo}.js` are unreferenced by
  any screen. `TaxInfo` still models a `paymentStatus`, a concept the app no
  longer has. They are dead files pending a decision to delete or adopt.
- `package-lock.json` is out of date: this release declares the five navigation
  dependencies that were previously imported but missing. Run `npm install`
  (not `npm ci`) once to regenerate it.

## [1.0.0]

- Initial cost basis engine, privacy heuristics, Electron wrapper, CSV export,
  portfolio dashboard, UTXO manager and transaction labelling.
