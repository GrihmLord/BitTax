/**
 * vault.js  (main process only)
 * Encrypted local persistence for coin-control state: UTXO freezes, labels and
 * transaction notes.
 *
 * These annotations are not incidental. "KYC-free", "from employer", "do not
 * spend" is a map of the user's financial life, and it previously lived only in
 * a JavaScript variable that died on reload. Writing it to disk is only an
 * improvement if it goes down encrypted.
 *
 * Encryption uses Electron's safeStorage, which is backed by the OS keystore:
 * DPAPI on Windows, Keychain on macOS, libsecret on Linux. If the platform
 * cannot provide that, the vault refuses to write rather than quietly falling
 * back to plaintext.
 */

const path = require('node:path');
const fs = require('node:fs/promises');

const VAULT_FILENAME = 'vault.enc';
const VAULT_VERSION = 1;
const MAX_VAULT_BYTES = 4 * 1024 * 1024;

class VaultUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VaultUnavailableError';
    }
}

const vaultPath = (app) => path.join(app.getPath('userData'), VAULT_FILENAME);

/**
 * @returns {{available: boolean, reason: string|null}}
 */
const encryptionStatus = (safeStorage) => {
    if (safeStorage.isEncryptionAvailable()) return { available: true, reason: null };
    return {
        available: false,
        reason: 'This system has no OS keystore available, so BitTax will not write your labels to disk. '
            + 'They stay in memory for this session only.',
    };
};

/** The on-disk envelope. Kept separate from the payload so the format can change. */
const wrap = (payload) => JSON.stringify({
    version: VAULT_VERSION,
    savedAt: new Date().toISOString(),
    payload,
});

const unwrap = (text) => {
    const envelope = JSON.parse(text);
    if (envelope.version !== VAULT_VERSION) {
        throw new Error(`Vault was written by a different version (${envelope.version}); refusing to guess at its layout`);
    }
    return envelope.payload;
};

/**
 * Reads and decrypts the vault.
 *
 * @returns {Promise<{exists: boolean, payload: object|null}>}
 */
const readVault = async ({ app, safeStorage }) => {
    const status = encryptionStatus(safeStorage);
    if (!status.available) throw new VaultUnavailableError(status.reason);

    let ciphertext;
    try {
        ciphertext = await fs.readFile(vaultPath(app));
    } catch (error) {
        if (error.code === 'ENOENT') return { exists: false, payload: null };
        throw error;
    }

    if (ciphertext.length > MAX_VAULT_BYTES) {
        throw new Error('Vault file is implausibly large and was not read');
    }

    return { exists: true, payload: unwrap(safeStorage.decryptString(ciphertext)) };
};

/**
 * Encrypts and writes the vault.
 *
 * The write goes to a temporary file and is then renamed, so an interrupted
 * save cannot leave a half-written vault where a readable one used to be.
 *
 * @param {object} payload - plain JSON-serialisable state
 */
const writeVault = async ({ app, safeStorage }, payload) => {
    const status = encryptionStatus(safeStorage);
    if (!status.available) throw new VaultUnavailableError(status.reason);

    const serialised = wrap(payload);
    if (Buffer.byteLength(serialised, 'utf8') > MAX_VAULT_BYTES) {
        throw new Error('Refusing to save: the vault payload exceeds the size limit');
    }

    const target = vaultPath(app);
    const temporary = `${target}.tmp`;

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, safeStorage.encryptString(serialised), { mode: 0o600 });
    await fs.rename(temporary, target);

    return { savedAt: new Date().toISOString() };
};

/** Deletes the vault. Used by the "forget everything" action. */
const clearVault = async ({ app }) => {
    try {
        await fs.unlink(vaultPath(app));
        return { existed: true };
    } catch (error) {
        if (error.code === 'ENOENT') return { existed: false };
        throw error;
    }
};

const vaultExists = async ({ app }) => {
    try {
        await fs.access(vaultPath(app));
        return true;
    } catch {
        return false;
    }
};

module.exports = {
    VAULT_FILENAME,
    VAULT_VERSION,
    MAX_VAULT_BYTES,
    VaultUnavailableError,
    encryptionStatus,
    readVault,
    writeVault,
    clearVault,
    vaultExists,
    vaultPath,
};
