import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readVault, writeVault, clearVault, vaultPath, VaultUnavailableError } from '../../main/vault.js';

/** A stand-in keystore: reversible, and visibly not plaintext on disk. */
const fakeSafeStorage = (available = true) => ({
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (text) => Buffer.from(text, 'utf8').reverse(),
    decryptString: (buffer) => Buffer.from(buffer).reverse().toString('utf8'),
});

const context = (available = true) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bittax-vault-'));
    return { app: { getPath: () => dir }, safeStorage: fakeSafeStorage(available), dir };
};

test('a saved vault reads back, and is not plaintext on disk', async () => {
    const ctx = context();
    await writeVault(ctx, { histories: { BTC: [{ label: 'from employer' }] } });
    const raw = readFileSync(vaultPath(ctx.app), 'utf8');
    assert.ok(!raw.includes('from employer'));
    const { exists, payload } = await readVault(ctx);
    assert.equal(exists, true);
    assert.equal(payload.histories.BTC[0].label, 'from employer');
});

test('overlapping saves are serialised and the last one wins', async () => {
    const ctx = context();
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeVault(ctx, { n: i })));
    assert.equal((await readVault(ctx)).payload.n, 19);
    assert.deepEqual(readdirSync(ctx.dir), ['vault.enc'], 'no temporary file is left behind');
});

test('a clear queued behind a save is not undone by it', async () => {
    const ctx = context();
    const saving = writeVault(ctx, { n: 1 });
    const clearing = clearVault(ctx);
    await Promise.all([saving, clearing]);
    assert.equal((await readVault(ctx)).exists, false);
});

test('without a keystore nothing is written', async () => {
    const ctx = context(false);
    await assert.rejects(writeVault(ctx, { n: 1 }), VaultUnavailableError);
    assert.deepEqual(readdirSync(ctx.dir), []);
});
