# Finishing the release

One command does all of it:

```bash
bash scripts/finish.sh
```

It verifies, builds, commits, merges into `main`, pushes, and deletes the working
branch. It creates no new branches, stops at the first failure, and never merges
unverified code. Nothing in it rewrites history — no reset, no rebase, no force
push.

Everything below is the same sequence by hand, plus what to do if a step fails.

The session that wrote this code had `npm`, `node --test` and every git write
blocked, so none of it has been executed.

## 1. Verify

```bash
npm install          # electron + electron-builder only; there are no runtime deps
npm test             # 18 suites, 184 assertions over the audit core
npm run verify       # smoke checks; these now exit non-zero on failure
```

### If `npm test` fails

Read the first failing suite. They are ordered from most primitive to most
assembled, so the earliest failure is the real cause and the rest are fallout.

| Failing suite | What it means |
| --- | --- |
| `decimal` / `money` | Integer money arithmetic. Everything else sits on this. |
| `sha256` | Cross-checked against `node:crypto`, so a failure is a real bug, not a bad constant. |
| `base58` | Checked against the genesis address — the alphabet or the checksum is wrong. |
| `secp256k1` | Curve arithmetic. The assertions are group identities, so a failure is algebra, not data. |
| `bech32` | Checked against the BIP173 vector. |
| `bip32` | **Check the two vector strings at the top of the file against BIP32 before suspecting the algorithm.** If `secp256k1` and `bech32` pass but this fails, a mistyped constant is far more likely than broken arithmetic. |
| `derive` | The main-process self-test. Its failure list names the exact check that broke. |
| `gains` / `washsale` / `tax` / `csv` | The audit engine itself. |
| `ipcValidation` | The renderer-to-main boundary: bounds, filename safety, unknown fields. |

The same two BIP32 constants appear in `src/main/derive.mjs` as `BIP32_VECTOR`
and in `src/core/__tests__/bip32.test.js` as `VECTOR`. Fix both if they are wrong.

## 2. Build

```bash
npm run dist         # -> dist/BitTax Audit-1.1.0-win.exe
```

If it fails, in order of likelihood:

1. `assets/icon.png` smaller than 256x256 — electron-builder requires at least that.
2. Something the main process loads at runtime is missing from the `files`
   allowlist in `package.json`.
3. It looks hung with no output for several minutes. On Windows this is usually
   Defender scanning every file electron-builder reads: it loads ~3,000 modules
   before printing its first line, so at a throttled read rate the banner alone
   can take five minutes. Measure before assuming a deadlock — sample the
   process's CPU twice; a real hang shows no movement at all. Excluding the
   project directory from real-time scanning is what actually fixes it.
   `build.npmRebuild` is already `false`, which skips a full dependency-tree
   walk that this project never needs.

## 3. Check it by hand

```bash
npm run electron
```

- Load the demo profile, switch FIFO / LIFO / HIFO, confirm the numbers move.
- Freeze a lot in **UTXO manager**, confirm selection changes on re-run.
- Type `=1+1` into a label, export, confirm the CSV contains `'=1+1` and not a formula.
- Paste an `xprv` into the key box — it must be refused and the field cleared.
- Paste a real `xpub`, open **Addresses**, derive, and compare against your wallet.
  If the self-test failed the button is disabled with the reason on screen: that
  is the designed behaviour, not a crash.

## 4. Land it

`scripts/finish.sh` does this. By hand:

```bash
git add <paths>                          # the script lists them explicitly
git commit -F tasks/commit-message.txt
git checkout main
git merge --no-ff agent/a10-secret-scanning
git push origin main
git branch -d agent/a10-secret-scanning
```

No new branch is created. `agent/a10-secret-scanning` is local-only, so deleting
it needs no remote cleanup, and its one commit — `4b70c30`, the gitleaks
workflow — is carried forward. `.github/workflows/secrets.yml` is untouched and
still runs alongside the new `ci.yml`.

For a pull request instead, push the existing branch and open the PR from it —
still no new branch:

```bash
git push -u origin agent/a10-secret-scanning
gh pr create --base main --fill
gh pr merge --merge --delete-branch
```

## 5. Decisions, now settled

Both open product calls were resolved by removing the React Native tree:
`src/{screens,services,components,redux,Navigation,utils}`, `App.js`, `App.tsx`
and the Expo/TypeScript scaffolding are gone. The desktop app is the product, the
mobile prototype had no automated coverage, and everything it computed already
lives in `src/core`. `scripts/finish.sh` no longer names those paths — re-adding
a path there that does not exist will abort the script under `set -e`.
