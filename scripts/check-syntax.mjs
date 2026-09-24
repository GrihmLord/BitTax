/**
 * check-syntax.mjs
 * Parses every JavaScript source in the repository with `node --check`.
 *
 * The Electron entry points and the renderer are never executed by the unit
 * tests, so a syntax error there would otherwise ship. This needs no install
 * and behaves the same on every platform.
 */

import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);
const SOURCE = /\.(c|m)?js$/;

const walk = (dir) => readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return SOURCE.test(name) ? [full] : [];
});

const files = walk(ROOT);
const failures = files.filter((file) => {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) process.stderr.write(result.stderr);
    return result.status !== 0;
});

console.log(`Parsed ${files.length} files; ${failures.length} failed.`);
process.exit(failures.length === 0 ? 0 : 1);
