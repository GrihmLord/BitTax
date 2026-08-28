/**
 * test.mjs
 * Runs the audit core's test suites.
 *
 * WHY THIS EXISTS
 * The npm script used to be `node --test src/core/__tests__/ src/services/`.
 * Node 22 treats positional `--test` arguments as file patterns rather than
 * directories to walk, so it tried to `require()` the folders themselves,
 * failed with MODULE_NOT_FOUND, and reported it as two failing tests. The suite
 * had never run once.
 *
 * Test files are therefore enumerated here and passed explicitly. That depends
 * on nothing — not on Node's glob support, not on the shell expanding a
 * wildcard, so it behaves the same on Windows, macOS and Linux.
 *
 * The zero-file guard matters as much as the runner: a test command that passes
 * because it matched nothing is the same defect as a verifier that prints
 * "[FAIL]" and exits 0, which is exactly how a broken cost-basis method reached
 * a commit in this repository.
 */

import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Directories searched for test files, relative to the repository root. */
const TEST_DIRECTORIES = ['src/core/__tests__'];

const TEST_FILE = /\.test\.(js|mjs)$/;

const collect = (relativeDir) => {
    const absolute = path.join(ROOT, relativeDir);
    if (!existsSync(absolute)) return [];

    return readdirSync(absolute)
        .filter((name) => TEST_FILE.test(name))
        .sort()
        .map((name) => path.join(absolute, name));
};

const files = TEST_DIRECTORIES.flatMap(collect);

if (files.length === 0) {
    console.error(
        `No test files found in: ${TEST_DIRECTORIES.join(', ')}.\n`
        + 'Refusing to report success for a suite that did not run.',
    );
    process.exit(1);
}

console.log(`Running ${files.length} test file${files.length === 1 ? '' : 's'}.\n`);

const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: ROOT,
    stdio: 'inherit',
});

if (result.error) {
    console.error(`Could not start the test runner: ${result.error.message}`);
    process.exit(1);
}

process.exit(result.status ?? 1);
