/**
 * vault.js  (main process only)
 * Encrypted local persistence for the user's history and coin-control state:
 * transactions, UTXO freezes, labels and notes.
 *
 * These annotations are not incidental. "KYC-free", "from employer", "do not
 * spend" is a map of the user's financial life. Writing it to disk is only an
 * improvement if it goes down encrypted.
 *
 * Encryption uses Electron's safeStorage, which is backed by the OS keystore:
 * DPAPI on Windows, Keychain on macOS, libsecret or KWallet on Linux. On a
 * Linux desktop with no recognised keyring, safeStorage reports itself
 * "available" but falls back to `basic_text`: a key hardcoded into Chromium,
 * which is obfuscation rather than encryption. The vault treats that backend
 * as unavailable and refuses to write, rather than quietly storing a blob
 * anyone can decrypt.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

export const VAULT_FILENAME = 'vault.enc';
export const VAULT_VERSION = 1;
export const MAX_VAULT_BYTES = 32 * 1024 * 1024;

/** Linux backends that provide no real secret. */
const INSECURE_LINUX_BACKENDS = new Set(['basic_text', 'unknown']);

export class VaultUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VaultUnavailableError';
    }
}

export const vaultPath = (app) => path.join(app.getPath('userData'), VAULT_FILENAME);

/**
 * @param {object} safeStorage
 * @param {string} [platform]
 * @returns {{available: boolean, reason: string|null, backend: string|null}}
 */
export const encryptionStatus = (safeStorage, platform = process.platform) => {
    if (!safeStorage.isEncryptionAvailable()) {
        return {
            available: false,
            backend: null,
            reason: 'This system has no OS keystore available, so BitTax will not write your data to disk. '
                + 'It stays in memory for this session only.',
        };
    }

    if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
        const backend = safeStorage.getSelectedStorageBackend();
        if (INSECURE_LINUX_BACKENDS.has(backend)) {
            return {
                available: false,
                backend,
                reason: 'No keyring (GNOME Keyring or KWallet) was found, so the only encryption on offer uses a '
                    + 'key built into the app. BitTax will not write your data under it; nothing is saved this session.',
            };
        }
        return { available: true, backend, reason: null };
    }

    return { available: true, backend: null, reason: null };
};

/** The on-disk envelope. Kept separate from the payload so the format can change. */
const wrap = (payload) => JSON.stringify({
    version: VAULT_VERSION,
    savedAt: new Date().toISOString(),
    payload,
});

const unwrap = (text) => {
    const envelope = JSON.parse(text);
    if (!envelope || typeof envelope !== 'object') throw new Error('Vault contents are not an object');
    if (envelope.version !== VAULT_VERSION) {
        throw new Error(`Vault was written by a different version (${envelope.version}); refusing to guess at its layout`);
    }
    return envelope.payload;
};

/**
 * Serialises vault operations. Two overlapping saves would otherwise race on
 * the same temporary file, and a clear could land between a save's write and
 * its rename, resurrecting data the user just asked to delete.
 */
let queue = Promise.resolve();
const exclusive = (operation) => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => {});
    return run;
};

const requireEncryption = (safeStorage) => {
    const status = encryptionStatus(safeStorage);
    if (!status.available) throw new VaultUnavailableError(status.reason);
};

/**
 * Reads and decrypts the vault.
 *
 * @returns {Promise<{exists: boolean, payload: object|null}>}
 */
export const readVault = ({ app, safeStorage }) => exclusive(async () => {
    requireEncryption(safeStorage);

    let ciphertext;
    try {
        const stat = await fs.stat(vaultPath(app));
        if (stat.size > MAX_VAULT_BYTES) throw new Error('Vault file is implausibly large and was not read');
        ciphertext = await fs.readFile(vaultPath(app));
    } catch (error) {
        if (error.code === 'ENOENT') return { exists: false, payload: null };
        throw error;
    }

    return { exists: true, payload: unwrap(safeStorage.decryptString(ciphertext)) };
});

/**
 * Encrypts and writes the vault.
 *
 * The write goes to a temporary file, is flushed to disk, and is then renamed
 * over the old vault, so a crash or power loss mid-save leaves either the old
 * vault or the new one — never a truncated file where a readable one was.
 *
 * @param {object} payload - plain JSON-serialisable state
 */
export const writeVault = ({ app, safeStorage }, payload) => exclusive(async () => {
    requireEncryption(safeStorage);

    const serialised = wrap(payload);
    if (Buffer.byteLength(serialised, 'utf8') > MAX_VAULT_BYTES) {
        throw new Error('Refusing to save: the vault payload exceeds the size limit');
    }

    const target = vaultPath(app);
    const temporary = `${target}.tmp`;

    await fs.mkdir(path.dirname(target), { recursive: true });
    const handle = await fs.open(temporary, 'w', 0o600);
    try {
        await handle.writeFile(safeStorage.encryptString(serialised));
        await handle.sync();
    } finally {
        await handle.close();
    }
    await fs.rename(temporary, target);

    return { savedAt: new Date().toISOString() };
});

const unlinkIfPresent = async (file) => {
    try {
        await fs.unlink(file);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
};

/** Deletes the vault and any interrupted save. Used by the "forget everything" action. */
export const clearVault = ({ app }) => exclusive(async () => {
    const target = vaultPath(app);
    const existed = await unlinkIfPresent(target);
    await unlinkIfPresent(`${target}.tmp`);
    return { existed };
});

export const vaultExists = async ({ app }) => {
    try {
        await fs.access(vaultPath(app));
        return true;
    } catch {
        return false;
    }
};
