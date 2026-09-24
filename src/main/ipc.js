/**
 * ipc.js  (main process only)
 * The complete privileged surface available to the renderer.
 *
 * The renderer is treated as untrusted: it renders data the user pasted in, so
 * a bug there must not become a way to write arbitrary files, fill the disk,
 * or persist something it should not. Every channel therefore:
 *   - checks the call came from the app's own page (`app://bittax`), and
 *   - validates its input against the same definitions the engine uses.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

import * as vault from './vault.js';
import { APP_ORIGIN } from './protocol.js';
import { SUPPORTED_ASSETS } from '../core/assets.js';
import { COST_BASIS_METHODS } from '../core/lots.js';
import { FILING_STATUS } from '../core/taxTables.js';
import { TX_TYPES } from '../core/transactions.js';
import { detectSecretMaterial, SECRET_KIND } from '../core/secrets.js';

const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_LABEL_LENGTH = 512;
const MAX_NOTE_LENGTH = 2048;
const MAX_ANNOTATIONS = 20000;
/** Matches the importer's row limit, so anything that imports can be saved. */
const MAX_TRANSACTIONS = 100000;
const MAX_ID_LENGTH = 256;
const MAX_KEY_LENGTH = 256;
const MAX_DECIMAL_LENGTH = 64;

/** Channel names. preload.cjs cannot import this module; a test keeps the two in step. */
export const CHANNELS = Object.freeze({
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
 * Loaded lazily so the elliptic curve self-test stays out of application
 * startup — it only runs the first time someone asks for addresses.
 */
let derivationModule = null;
const loadDerivation = async () => {
    derivationModule ??= await import('./derive.js');
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

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * Free text the user typed is screened for spending material before it can be
 * written to disk. A seed phrase pasted into a label is still a seed phrase.
 *
 * A bare 64-digit hex string is let through here: in a note it is far more
 * likely to be a transaction id than a raw private key.
 */
const asAnnotation = (value, max, field) => {
    const text = asBoundedString(value, max, field);
    const secret = detectSecretMaterial(text);
    if (secret && secret.kind !== SECRET_KIND.RAW_PRIVATE_KEY) invalid(`${field} was not saved. ${secret.message}`);
    return text;
};

const entriesOf = (raw, field) => {
    const entries = Object.entries(asPlainObject(raw, field));
    if (entries.length > MAX_ANNOTATIONS) invalid(`${field} holds more than ${MAX_ANNOTATIONS} entries`);
    return entries;
};

/** Validates the coin-control map: `{ 'lot:tx-1': { frozen: bool, label: string } }`. */
const validateLotState = (raw) => {
    const clean = {};
    for (const [id, state] of entriesOf(raw, 'lotState')) {
        asBoundedString(id, MAX_ID_LENGTH, 'lot id');
        const value = asPlainObject(state, `lotState["${id}"]`);
        clean[id] = {
            frozen: Boolean(value.frozen),
            label: asAnnotation(value.label ?? '', MAX_LABEL_LENGTH, `label for ${id}`),
        };
    }
    return clean;
};

/** Validates the note map: `{ 'tx-1': 'Gift to family' }`. */
const validateNotes = (raw) => {
    const clean = {};
    for (const [id, note] of entriesOf(raw, 'txNotes')) {
        asBoundedString(id, MAX_ID_LENGTH, 'transaction id');
        clean[id] = asAnnotation(note, MAX_NOTE_LENGTH, `note for ${id}`);
    }
    return clean;
};

/** Decimal fields a persisted transaction may carry. */
const TX_DECIMAL_FIELDS = ['amount', 'price', 'total', 'fee'];

/**
 * Validates one persisted transaction.
 *
 * Amounts stay as strings: they are decimal values that the engine parses into
 * exact integers, and round-tripping them through a JSON number would reintroduce
 * the floating point error the engine exists to avoid. An unknown type is
 * refused rather than coerced — turning a corrupted row into a purchase would
 * invent a tax lot.
 */
const validateTransaction = (raw, index, asset) => {
    const tx = asPlainObject(raw, `histories.${asset}[${index}]`);
    if (!TX_TYPES.includes(tx.type)) invalid(`histories.${asset}[${index}].type must be one of ${TX_TYPES.join(', ')}`);

    const clean = {
        type: tx.type,
        date: asBoundedString(String(tx.date ?? ''), 64, `histories.${asset}[${index}].date`),
        asset,
    };
    if (tx.id !== undefined && tx.id !== null && tx.id !== '') {
        clean.id = asBoundedString(String(tx.id), MAX_ID_LENGTH, `histories.${asset}[${index}].id`);
    }
    if (tx.isCoinJoin) clean.isCoinJoin = true;
    if (tx.isLightning) clean.isLightning = true;
    if (tx.isIncome) clean.isIncome = true;

    for (const field of TX_DECIMAL_FIELDS) {
        const value = tx[field];
        if (value === undefined || value === null) continue;
        clean[field] = asBoundedString(String(value), MAX_DECIMAL_LENGTH, `histories.${asset}[${index}].${field}`);
    }

    return clean;
};

/** Validates the saved transaction history, grouped by asset. */
const validateHistories = (raw) => {
    const clean = {};
    let total = 0;

    for (const [asset, list] of Object.entries(asPlainObject(raw ?? {}, 'histories'))) {
        if (!SUPPORTED_ASSETS.includes(asset)) continue;
        if (!Array.isArray(list)) invalid(`histories.${asset} must be an array`);

        total += list.length;
        if (total > MAX_TRANSACTIONS) invalid(`Saved history holds more than ${MAX_TRANSACTIONS} transactions`);

        clean[asset] = list.map((tx, index) => validateTransaction(tx, index, asset));
    }

    return clean;
};

/** Validates the per-asset mark prices the user typed in. */
const validateMarkPrices = (raw) => {
    const clean = {};
    for (const [asset, price] of Object.entries(asPlainObject(raw ?? {}, 'markPrices'))) {
        if (!SUPPORTED_ASSETS.includes(asset)) continue;
        clean[asset] = asBoundedString(String(price ?? ''), MAX_DECIMAL_LENGTH, `markPrices.${asset}`);
    }
    return clean;
};

const optionalDecimal = (value, field) => asBoundedString(String(value ?? ''), MAX_DECIMAL_LENGTH, field);

/** Validates the persisted preferences. Unknown keys are dropped, not trusted. */
const validateSettings = (raw) => {
    const source = asPlainObject(raw ?? {}, 'settings');
    return {
        method: oneOf(source.method, COST_BASIS_METHODS, 'FIFO'),
        asset: oneOf(source.asset, SUPPORTED_ASSETS, 'BTC'),
        applyWashSale: source.applyWashSale === undefined ? true : Boolean(source.applyWashSale),
        respectFrozen: source.respectFrozen === undefined ? true : Boolean(source.respectFrozen),
        taxYear: Number.isInteger(source.taxYear) ? source.taxYear : null,
        filingStatus: oneOf(source.filingStatus, Object.values(FILING_STATUS), FILING_STATUS.SINGLE),
        otherIncome: optionalDecimal(source.otherIncome, 'settings.otherIncome'),
        carryoverShortTerm: optionalDecimal(source.carryoverShortTerm, 'settings.carryoverShortTerm'),
        carryoverLongTerm: optionalDecimal(source.carryoverLongTerm, 'settings.carryoverLongTerm'),
    };
};

export const validateVaultPayload = (raw) => {
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
export const safeCsvName = (suggested) => {
    const base = path.basename(asBoundedString(suggested ?? 'bittax_audit_8949.csv', 200, 'filename'));
    const stripped = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
    const named = stripped === '' ? 'bittax_audit' : stripped;
    return named.toLowerCase().endsWith('.csv') ? named : `${named}.csv`;
};

/**
 * Rejects IPC from anything but the app's own top-level page. Navigation is
 * already locked down, so this is defence in depth: if a frame ever did load
 * foreign content, it still could not reach the vault or the file system.
 */
export const assertTrustedSender = (event) => {
    const frame = event?.senderFrame;
    const url = frame?.url ?? '';
    if (!url.startsWith(`${APP_ORIGIN}/`) || (frame.parent !== null && frame.parent !== undefined)) {
        const error = new Error('IPC call from an untrusted frame was refused');
        error.name = 'IpcSenderError';
        throw error;
    }
};

/** Writes the report the user asked for, to the location the user picked. */
const handleExportCsv = async ({ dialog, BrowserWindow }, event, request) => {
    const { filename, content } = asPlainObject(request, 'export request');
    const text = asBoundedString(content, MAX_EXPORT_BYTES, 'content');
    if (text.trim() === '') invalid('Refusing to export an empty report');

    const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
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
    try {
        const payload = validateVaultPayload(request);
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
    try {
        const { extendedKey, chain, start, count } = asPlainObject(request, 'derive request');
        const key = asBoundedString(extendedKey, MAX_KEY_LENGTH, 'extendedKey');
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
export const registerIpcHandlers = (context) => {
    const { ipcMain, app, safeStorage } = context;

    const handle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
        assertTrustedSender(event);
        return handler(event, ...args);
    });

    handle(CHANNELS.APP_INFO, () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        offline: true,
        platform: process.platform,
    }));

    handle(CHANNELS.VAULT_STATUS, async () => ({
        ...vault.encryptionStatus(safeStorage),
        hasVault: await vault.vaultExists(context),
    }));

    handle(CHANNELS.VAULT_LOAD, () => handleVaultLoad(context));
    handle(CHANNELS.VAULT_SAVE, (event, request) => handleVaultSave(context, event, request));
    handle(CHANNELS.VAULT_CLEAR, () => vault.clearVault(context));
    handle(CHANNELS.EXPORT_CSV, (event, request) => handleExportCsv(context, event, request));

    handle(CHANNELS.DERIVE_STATUS, () => handleDeriveStatus());
    handle(CHANNELS.DERIVE_ADDRESSES, (event, request) => handleDeriveAddresses(event, request));
};
