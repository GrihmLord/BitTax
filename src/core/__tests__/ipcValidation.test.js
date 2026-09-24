import test from 'node:test';
import assert from 'node:assert/strict';

import { validateVaultPayload, safeCsvName } from '../../main/ipc.js';

/**
 * The renderer is treated as untrusted at this boundary: it renders text the
 * user pasted in, so a bug there must not become a way to write arbitrary files
 * or fill the disk with an unbounded vault.
 */

test('a well-formed payload passes through', () => {
    const clean = validateVaultPayload({
        lotState: { 'lot:tx-1': { frozen: true, label: 'KYC-free' } },
        txNotes: { 'tx-1': 'Gift' },
        histories: { BTC: [{ id: 'a', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '20000', fee: '5' }] },
        markPrices: { BTC: '45000' },
        settings: { method: 'HIFO', asset: 'BTC', applyWashSale: true, respectFrozen: true, taxYear: 2024, filingStatus: 'single' },
    });

    assert.equal(clean.lotState['lot:tx-1'].label, 'KYC-free');
    assert.equal(clean.txNotes['tx-1'], 'Gift');
    assert.equal(clean.histories.BTC.length, 1);
    assert.equal(clean.markPrices.BTC, '45000');
    assert.equal(clean.settings.method, 'HIFO');
});

test('an empty payload yields empty defaults rather than throwing', () => {
    const clean = validateVaultPayload({});

    assert.deepEqual(clean.lotState, {});
    assert.deepEqual(clean.txNotes, {});
    assert.deepEqual(clean.histories, {});
    assert.equal(clean.settings.method, 'FIFO');
});

/**
 * Amounts stay strings on the way to disk. Round-tripping "0.1" through a JSON
 * number would reintroduce exactly the floating point error the engine exists
 * to avoid.
 */
test('transaction amounts are preserved as strings', () => {
    const clean = validateVaultPayload({
        histories: { BTC: [{ id: 'a', type: 'BUY', date: '2023-01-01', amount: 0.1, price: 20000 }] },
    });

    assert.equal(typeof clean.histories.BTC[0].amount, 'string');
    assert.equal(clean.histories.BTC[0].amount, '0.1');
    assert.equal(clean.histories.BTC[0].price, '20000');
});

test('unknown assets and unknown settings are dropped, not trusted', () => {
    const clean = validateVaultPayload({
        histories: { BTC: [], DOGE: [{ id: 'x' }] },
        markPrices: { BTC: '1', DOGE: '2' },
        settings: { method: 'AVERAGE', asset: 'DOGE', taxYear: 'soon' },
    });

    assert.deepEqual(Object.keys(clean.histories), ['BTC']);
    assert.deepEqual(Object.keys(clean.markPrices), ['BTC']);
    assert.equal(clean.settings.method, 'FIFO', 'unknown method falls back');
    assert.equal(clean.settings.asset, 'BTC', 'unknown asset falls back');
    assert.equal(clean.settings.taxYear, null, 'a non-integer year is rejected');
});

/** Coercing a corrupted row into a BUY, as the previous build did, invents a tax lot. */
test('an unrecognised transaction type is refused, not coerced into a purchase', () => {
    assert.throws(() => validateVaultPayload({
        histories: { BTC: [{ id: 'a', type: 'TRANSFER', date: '2023-01-01', amount: '1', price: '1' }] },
    }), /type must be one of BUY, SELL/);
});

test('a seed phrase pasted into a label or note is never written to disk', () => {
    const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
    assert.throws(() => validateVaultPayload({ lotState: { 'lot:a': { frozen: false, label: seed } } }), /was not saved.*seed phrase/);
    assert.throws(() => validateVaultPayload({ txNotes: { a: 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi' } }), /PRIVATE key/);
    // A transaction id is 64 hex digits too; in a note it is almost always that.
    const txid = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
    assert.equal(validateVaultPayload({ txNotes: { a: txid } }).txNotes.a, txid);
});

test('settings default safely and keep the tax inputs as strings', () => {
    const clean = validateVaultPayload({
        settings: { filingStatus: 'martian', otherIncome: '85000', carryoverShortTerm: '1200.50' },
    });
    assert.equal(clean.settings.filingStatus, 'single');
    assert.equal(clean.settings.applyWashSale, true, 'an absent toggle keeps its default rather than flipping off');
    assert.equal(clean.settings.otherIncome, '85000');
    assert.equal(clean.settings.carryoverShortTerm, '1200.50');
    assert.equal(clean.settings.carryoverLongTerm, '');
});

test('oversized input is refused', () => {
    assert.throws(() => validateVaultPayload({
        lotState: { 'lot:1': { frozen: false, label: 'x'.repeat(600) } },
    }), /exceeds 512 characters/);

    assert.throws(() => validateVaultPayload({
        txNotes: { 'tx-1': 'x'.repeat(3000) },
    }), /exceeds 2048 characters/);

    const many = Array.from({ length: 100001 }, (_, i) => ({ id: `t${i}`, type: 'BUY', date: '2023-01-01', amount: '1', price: '1' }));
    assert.throws(() => validateVaultPayload({ histories: { BTC: many } }), /more than 100000 transactions/);
});

test('malformed structures are refused', () => {
    assert.throws(() => validateVaultPayload(null), /must be an object/);
    assert.throws(() => validateVaultPayload([]), /must be an object/);
    assert.throws(() => validateVaultPayload({ lotState: 'nope' }), /must be an object/);
    assert.throws(() => validateVaultPayload({ histories: { BTC: 'nope' } }), /must be an array/);
});

/** The renderer proposes a filename; it never chooses a directory. */
test('export filenames are reduced to a safe basename', () => {
    assert.equal(safeCsvName('report.csv'), 'report.csv');
    assert.equal(safeCsvName('report'), 'report.csv');
    assert.equal(safeCsvName('../../etc/passwd'), 'passwd.csv');
    assert.equal(safeCsvName('...'), 'bittax_audit.csv');
    assert.equal(safeCsvName(undefined), 'bittax_audit_8949.csv');
});

/**
 * Asserted as properties rather than exact strings: `path.basename` treats a
 * backslash as a separator on Windows and as an ordinary character elsewhere,
 * so the exact output is platform-dependent. What must hold on every platform
 * is that no separator survives.
 */
test('a filename cannot smuggle a path separator through', () => {
    const candidates = [
        'a/b.csv',
        'a\\b.csv',
        '..\\..\\x.csv',
        'C:\\Windows\\System32\\evil.csv',
        '/etc/cron.d/payload',
    ];

    for (const candidate of candidates) {
        const safe = safeCsvName(candidate);
        assert.ok(!safe.includes('/'), safe);
        assert.ok(!safe.includes('\\'), safe);
        assert.ok(!safe.includes(':'), safe);
        assert.ok(!safe.startsWith('.'), safe);
        assert.ok(safe.endsWith('.csv'), safe);
    }
});
