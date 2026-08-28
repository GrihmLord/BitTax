/**
 * ipc.js  (main process only)
 * The complete privileged surface available to the renderer.
 *
 * Every channel validates its input before acting. The renderer is treated as
 * untrusted: it renders data the user pasted in, so a bug there must not become
 * a way to write arbitrary files or fill the disk.
 */

const path = require('node:path');
const fs = require('node:fs/promises');

const vault = require('./vault.js');

const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_LABEL_LENGTH = 512;
const MAX_NOTE_LENGTH = 2048;
const MAX_ENTRIES = 10000;

const MAX_KEY_LENGTH = 256;

const CHANNELS = Object.freeze({
    APP_INFO: 'bittax:app:info',
    VAULT_STATUS: 'bittax:vault:status',
    VAULT_LOAD: 'bittax:vault:load',
    VAULT_SAVE: 'bittax:vault:save',
    VAULT_CLEAR: 'bittax:vault:clear',
    EXPORT_CSV: 'bittax:export:csv',
    DERIVE_STATUS: 'bittax:derive:status',
    DERIVE_ADDRESSES: 'bittax:derive:addresses',
});

/**
 * `derive.mjs` is ESM and this module is CommonJS, so it is pulled in with a
 * dynamic import. Loading it lazily also keeps the elliptic curve self-test out
 * of application startup — it only runs the first time someone asks for
 * addresses.
 */
let derivationModule = null;
const loadDerivation = async () => {
    if (!derivationModule) derivationModule = await import('./derive.mjs');
    return derivationModule;
};

const invalid = (message) => {
    const error = new Error(message);
    error.name = 'IpcValidationError';
    throw error;
};

const asBoundedString = (value, max, field) => {
    if (typeof value !== 'string') invalid(`${field} must be a string`);
    if (value.length > max) invalid(`${field} exceeds ${max} characters`);
    return value;
};

const asPlainObject = (value, field) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} must be an object`);
    return value;
};

/** Validates the coin-control map: `{ 'lot:tx-1': { frozen: bool, label: string } }`. */
const validateLotState = (raw) => {
    const source = asPlainObject(raw, 'lotState');
    const entries = Object.entries(source);
    if (entries.length > MAX_ENTRIES) invalid(`lotState holds more than ${MAX_ENTRIES} entries`);

    const clean = {};
    for (const [id, state] of entries) {
        asBoundedString(id, 256, 'lot id');
        const value = asPlainObject(state, `lotState["${id}"]`);
        clean[id] = {
            frozen: Boolean(value.frozen),
            label: asBoundedString(value.label ?? '', MAX_LABEL_LENGTH, `label for ${id}`),
        };
    }
    return clean;
};

/** Validates the note map: `{ 'tx-1': 'Gift to family' }`. */
const validateNotes = (raw) => {
    const source = asPlainObject(raw, 'txNotes');
    const entries = Object.entries(source);
    if (entries.length > MAX_ENTRIES) invalid(`txNotes holds more than ${MAX_ENTRIES} entries`);

    const clean = {};
    for (const [id, note] of entries) {
        asBoundedString(id, 256, 'transaction id');
        clean[id] = asBoundedString(note, MAX_NOTE_LENGTH, `note for ${id}`);
    }
    return clean;
};

/** Fields a persisted transaction may carry. Anything else is dropped. */
const TX_NUMERIC_FIELDS = ['amount', 'price', 'fee'];

/**
 * Validates one persisted transaction.
 *
 * Amounts stay as strings: they are decimal values that the engine parses into
 * exact integers, and round-tripping them through a JSON number would reintroduce
 * the floating point error the engine exists to avoid.
 */
const validateTransaction = (raw, index) => {
    const tx = asPlainObject(raw, `history[${index}]`);
    const clean = {
        id: asBoundedString(String(tx.id ?? `tx-${index}`), 256, `history[${index}].id`),
        type: tx.type === 'SELL' ? 'SELL' : 'BUY',
        date: asBoundedString(String(tx.date ?? ''), 64, `history[${index}].date`),
        asset: ['BTC', 'ETH'].includes(tx.asset) ? tx.asset : 'BTC',
        isCoinJoin: Boolean(tx.isCoinJoin),
        isLightning: Boolean(tx.isLightning),
    };

    for (const field of TX_NUMERIC_FIELDS) {
        const value = tx[field];
        if (value === undefined || value === null) continue;
        clean[field] = asBoundedString(String(value), 64, `history[${index}].${field}`);
    }

    return clean;
};

/** Validates the saved transaction history, grouped by asset. */
const validateHistories = (raw) => {
    const source = asPlainObject(raw ?? {}, 'histories');
    const clean = {};
    let total = 0;

    for (const [asset, list] of Object.entries(source)) {
        if (!['BTC', 'ETH'].includes(asset)) continue;
        if (!Array.isArray(list)) invalid(`histories.${asset} must be an array`);

        total += list.length;
        if (total > MAX_ENTRIES) invalid(`Saved history holds more than ${MAX_ENTRIES} transactions`);

        clean[asset] = list.map(validateTransaction);
    }

    return clean;
};

/** Validates the per-asset mark prices the user typed in. */
const validateMarkPrices = (raw) => {
    const source = asPlainObject(raw ?? {}, 'markPrices');
    const clean = {};

    for (const [asset, price] of Object.entries(source)) {
        if (!['BTC', 'ETH'].includes(asset)) continue;
        clean[asset] = asBoundedString(String(price ?? ''), 64, `markPrices.${asset}`);
    }

    return clean;
};

/** Validates the persisted preferences. Unknown keys are dropped, not trusted. */
const validateSettings = (raw) => {
    const source = asPlainObject(raw ?? {}, 'settings');
    return {
        method: ['FIFO', 'LIFO', 'HIFO'].includes(source.method) ? source.method : 'FIFO',
        asset: ['BTC', 'ETH'].includes(source.asset) ? source.asset : 'BTC',
        applyWashSale: Boolean(source.applyWashSale),
        respectFrozen: Boolean(source.respectFrozen),
        taxYear: Number.isInteger(source.taxYear) ? source.taxYear : null,
        filingStatus: asBoundedString(source.filingStatus ?? 'single', 64, 'filingStatus'),
    };
};

const validateVaultPayload = (raw) => {
    const payload = asPlainObject(raw, 'payload');
    return {
        lotState: validateLotState(payload.lotState ?? {}),
        txNotes: validateNotes(payload.txNotes ?? {}),
        settings: validateSettings(payload.settings),
        histories: validateHistories(payload.histories),
        markPrices: validateMarkPrices(payload.markPrices),
    };
};

/**
 * Reduces a suggested filename to a safe basename with a `.csv` extension.
 * The renderer proposes a name; it never chooses a directory.
 */
const safeCsvName = (suggested) => {
    const base = path.basename(asBoundedString(suggested ?? 'bittax_audit_8949.csv', 200, 'filename'));
    const stripped = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
    const named = stripped === '' ? 'bittax_audit' : stripped;
    return named.toLowerCase().endsWith('.csv') ? named : `${named}.csv`;
};

/** Writes the report the user asked for, to the location the user picked. */
const handleExportCsv = async ({ dialog, BrowserWindow }, _event, request) => {
    const { filename, content } = asPlainObject(request, 'export request');
    const text = asBoundedString(content, MAX_EXPORT_BYTES, 'content');
    if (text.trim() === '') invalid('Refusing to export an empty report');

    const [window] = BrowserWindow.getAllWindows();
    const result = await dialog.showSaveDialog(window, {
        title: 'Save audit report',
        defaultPath: safeCsvName(filename),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    await fs.writeFile(result.filePath, text, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, canceled: false, path: result.filePath };
};

const handleVaultLoad = async (context) => {
    try {
        const { exists, payload } = await vault.readVault(context);
        return { ok: true, exists, payload: payload ? validateVaultPayload(payload) : null };
    } catch (error) {
        return { ok: false, exists: false, payload: null, error: error.message, name: error.name };
    }
};

const handleVaultSave = async (context, _event, request) => {
    const payload = validateVaultPayload(request);
    try {
        const { savedAt } = await vault.writeVault(context, payload);
        return { ok: true, savedAt };
    } catch (error) {
        return { ok: false, error: error.message, name: error.name };
    }
};

/**
 * Reports whether derivation is usable, without throwing.
 * The renderer uses this to decide whether to offer the feature at all.
 */
const handleDeriveStatus = async () => {
    try {
        const { runSelfTest, MAX_ADDRESSES } = await loadDerivation();
        const report = runSelfTest();
        return { available: report.ok, failures: report.failures, maxAddresses: MAX_ADDRESSES };
    } catch (error) {
        return { available: false, failures: [error.message], maxAddresses: 0 };
    }
};

/**
 * Derives addresses from a watch-only extended key.
 *
 * The key is bounded here and fully validated downstream by
 * `parseExtendedPublicKey`, which also refuses private material.
 */
const handleDeriveAddresses = async (_event, request) => {
    const { extendedKey, chain, start, count } = asPlainObject(request, 'derive request');
    const key = asBoundedString(extendedKey, MAX_KEY_LENGTH, 'extendedKey');

    try {
        const { deriveAddresses } = await loadDerivation();
        return {
            ok: true,
            ...deriveAddresses(key, {
                chain: Number.isInteger(chain) ? chain : 0,
                start: Number.isInteger(start) ? start : 0,
                count: Number.isInteger(count) ? count : 20,
            }),
        };
    } catch (error) {
        return { ok: false, name: error.name, error: error.message, failures: error.failures || [] };
    }
};

/**
 * Registers every privileged channel.
 *
 * @param {{ipcMain:object, dialog:object, safeStorage:object, app:object, BrowserWindow:object}} context
 */
const registerIpcHandlers = (context) => {
    const { ipcMain, app, safeStorage } = context;

    ipcMain.handle(CHANNELS.APP_INFO, () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        offline: true,
        platform: process.platform,
    }));

    ipcMain.handle(CHANNELS.VAULT_STATUS, async () => ({
        ...vault.encryptionStatus(safeStorage),
        hasVault: await vault.vaultExists(context),
    }));

    ipcMain.handle(CHANNELS.VAULT_LOAD, () => handleVaultLoad(context));
    ipcMain.handle(CHANNELS.VAULT_SAVE, (event, request) => handleVaultSave(context, event, request));
    ipcMain.handle(CHANNELS.VAULT_CLEAR, () => vault.clearVault(context));
    ipcMain.handle(CHANNELS.EXPORT_CSV, (event, request) => handleExportCsv(context, event, request));

    ipcMain.handle(CHANNELS.DERIVE_STATUS, () => handleDeriveStatus());
    ipcMain.handle(CHANNELS.DERIVE_ADDRESSES, (event, request) => handleDeriveAddresses(event, request));
};

module.exports = { registerIpcHandlers, CHANNELS, safeCsvName, validateVaultPayload };
