#!/usr/bin/env bash
#
# finish.sh — verify, build, and land the remediation on main.
#
# Run from the repository root:
#     bash scripts/finish.sh
#
# It stops at the first failure and never merges unverified code: the tests and
# the build both have to pass before anything is committed. Nothing here is
# destructive to your history — no reset, no force push, no rebase.
#
# Creates no new branches. The work is committed on the branch it already lives
# on, merged into main, and that branch is then deleted.

set -euo pipefail

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f package.json ] || fail "run this from the repository root"
[ -d .git ] || fail "not a git repository"

WORK_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$WORK_BRANCH" != "HEAD" ] || fail "detached HEAD; check out a branch first"

say "Working branch: $WORK_BRANCH"

# ---------------------------------------------------------------------------
# 1. Verify. This is the step that matters — everything after it assumes the
#    audit engine is correct.
# ---------------------------------------------------------------------------

say "Installing dependencies (npm install, not ci — the lockfile is stale)"
npm install || fail "npm install"

say "Running the test suite"
npm test || fail "npm test — see tasks/finish.md for which suite means what"

say "Running the smoke verifiers"
npm run verify || fail "npm run verify"

# ---------------------------------------------------------------------------
# 2. Build.
# ---------------------------------------------------------------------------

say "Building the desktop installer"
npm run dist || fail "npm run dist"

say "Build output:"
ls -lh dist/*.exe dist/*.dmg dist/*.AppImage 2>/dev/null || ls -lh dist/ || true

# ---------------------------------------------------------------------------
# 3. Housekeeping before the commit.
# ---------------------------------------------------------------------------

for stray in README.md.tmp.*; do
  if [ -e "$stray" ]; then
    say "Removing stray temp file: $stray"
    rm -f "$stray"
  fi
done

# ---------------------------------------------------------------------------
# 4. Stage by name. Deliberately not `git add -A`: dist/ and node_modules are
#    gitignored, but naming the paths means nothing unexpected can ride along.
# ---------------------------------------------------------------------------

say "Staging changes"
git add \
  .gitignore \
  README.md \
  CHANGELOG.md \
  audit_demo.html \
  gui_demo.html \
  main.js \
  preload.js \
  package.json \
  package-lock.json \
  .github/workflows/ci.yml \
  renderer \
  scripts \
  tasks \
  src/core \
  src/main \
  verify_audit.mjs \
  verify_privacy.mjs

say "About to commit:"
git status --short

# ---------------------------------------------------------------------------
# 5. Commit and merge into main. No new branch is created at any point.
# ---------------------------------------------------------------------------

say "Committing"
git commit -F tasks/commit-message.txt || fail "git commit"

say "Merging $WORK_BRANCH into main"
git checkout main || fail "git checkout main"
git pull --ff-only origin main || echo "(no remote main to pull, continuing)"
git merge --no-ff "$WORK_BRANCH" -m "Merge $WORK_BRANCH: audit engine remediation" || fail "merge"

say "Pushing main"
git push origin main || fail "git push"

say "Deleting $WORK_BRANCH"
git branch -d "$WORK_BRANCH" || echo "(branch not fully merged; left in place)"
git remote prune origin || true

say "Done. main is up to date and the installer is in dist/."
git log --oneline -3

# ---------------------------------------------------------------------------
# If you would rather land this through a pull request, stop before step 5 and
# run these instead. It still creates no new branch — the PR is opened from the
# branch the work is already on:
#
#     git push -u origin "$WORK_BRANCH"
#     gh pr create --base main --fill
#     gh pr merge --merge --delete-branch
# ---------------------------------------------------------------------------
