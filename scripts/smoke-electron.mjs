/**
 * smoke-electron.mjs
 * Launches the real desktop app and drives it end to end.
 *
 * The unit tests prove the engine; they never load main.js, the preload
 * bridge, the app:// protocol or the renderer. This does: it boots Electron
 * exactly as a user would, loads the demo profile, and checks the figures,
 * coin control, secret refusal, address derivation and the network kill
 * switch through the UI.
 *
 * Needs `npm install` (Electron and playwright-core) and a display. On Linux CI:
 *     xvfb-run -a npm run smoke
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BIP84_ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const step = (name) => console.log(`- ${name}`);

const app = await electron.launch({ args: [ROOT], cwd: ROOT });
const pageErrors = [];

try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.waitForFunction(() => document.getElementById('versionBadge')?.textContent !== '');

    const text = (id) => page.$eval(`#${id}`, (node) => node.textContent);
    const rows = (id) => page.$$eval(`#${id} tr`, (list) => list.map((row) => row.innerText.replace(/\s+/g, ' ').trim()));

    step('boots with the preload bridge');
    assert.match(await text('versionBadge'), /^v\d+\.\d+\.\d+$/);

    step('demo profile audits both assets');
    await page.click('#demoButton');
    assert.match(await text('statusLine'), /Audited BTC and ETH/);
    assert.equal(await page.$eval('#taxYearSelect', (node) => node.value), '2024');

    step('disposals are scoped to the tax year');
    await page.click('.tab[data-view="audit"]');
    assert.equal(await text('stDisposals'), '1');
    assert.equal(await text('stNet'), '$3,965.00');
    await page.selectOption('#taxYearSelect', '2023');
    await page.waitForFunction(() => document.getElementById('stDisposals').textContent === '2');
    const disposals = await rows('disposalsBody');
    assert.match(disposals[0], /WASH SALE/);
    assert.match(disposals[0], /\$0\.00/, 'the washed loss is fully disallowed');

    step('the wash-sale replacement carries the deferred loss');
    await page.click('.tab[data-view="utxo"]');
    const lots = await rows('utxoBody');
    assert.match(lots[0], /WASH \+\$3,070\.00/);

    step('freezing a lot changes which lot a sale draws on');
    await page.click('#utxoBody tr button');
    await page.waitForFunction(() => document.querySelector('#utxoBody tr').innerText.includes('Frozen'));
    assert.match((await rows('utxoBody'))[0], /0\.9/);

    step('a seed phrase is refused and cleared');
    await page.fill('#keyInput', SEED);
    await page.click('#auditButton');
    assert.equal(await page.$eval('#secretBanner', (node) => node.classList.contains('is-hidden')), false);
    assert.equal(await page.$eval('#keyInput', (node) => node.value), '');

    step('derivation reproduces the BIP84 reference address');
    await page.fill('#keyInput', BIP84_ZPUB);
    await page.click('.tab[data-view="addresses"]');
    await page.click('#deriveButton');
    await page.waitForFunction(() => document.querySelectorAll('#addressesBody tr').length === 20, null, { timeout: 15000 });
    assert.match((await rows('addressesBody'))[0], /bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/);

    step('the renderer cannot reach the network');
    const outcome = await page.evaluate(async () => {
        try {
            await fetch('https://example.com/');
            return 'reached';
        } catch {
            return 'blocked';
        }
    });
    assert.equal(outcome, 'blocked');

    step('the renderer has no Node');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.process), 'undefined');

    step('a CSV import replaces the demo, skipping transfers');
    const csv = path.join(mkdtempSync(path.join(tmpdir(), 'bittax-smoke-')), 'history.csv');
    writeFileSync(csv, 'Date,Type,Amount,Price,Fee\n2025-01-02,Buy,0.5,90000,10\n2025-02-01,Send,0.1,95000,0\n2025-03-01,Sell,0.2,80000,5\n');
    await page.setInputFiles('#importInput', csv);
    await page.waitForFunction(() => document.getElementById('demoBanner').classList.contains('is-hidden'));
    await page.selectOption('#taxYearSelect', '2025');
    await page.click('.tab[data-view="audit"]');
    await page.waitForFunction(() => document.getElementById('stDisposals').textContent === '1');
    assert.equal(await text('stNet'), '-$2,009.00');
    await page.click('.tab[data-view="notices"]');
    assert.ok((await page.$$eval('#noticesList li', (list) => list.map((item) => item.textContent)))
        .some((notice) => /IMPORT_SKIPPED.*transfer between wallets/.test(notice)));

    assert.deepEqual(pageErrors, [], 'no uncaught renderer errors');
    console.log('\nDesktop smoke test passed.');
} finally {
    await app.close();
}
