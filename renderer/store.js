/**
 * store.js
 * Renderer state and its encrypted persistence.
 *
 * Coin-control annotations used to live in a bare object that died on reload.
 * They now round-trip through the main process, which encrypts them with the
 * OS keystore. Saves are debounced so typing in a label field does not write
 * to disk on every keystroke.
 */

import { DEFAULT_TAX_YEAR, FILING_STATUS } from '../src/core/taxTables.js';

const SAVE_DEBOUNCE_MS = 400;

/** The bridge exposed by preload.js. Absent when the page is opened outside Electron. */
const bridge = () => (typeof window !== 'undefined' ? window.bittax : undefined);

export const createStore = () => ({
    /** Raw transaction history per asset, from import or the demo profile. */
    histories: {},
    /** User-supplied current price per asset, as a decimal string. */
    markPrices: {},
    /** Coin control: lot id -> { frozen, label }. Persisted. */
    lotState: {},
    /** Transaction id -> free text note. Persisted. */
    txNotes: {},
    /** Engine results per asset, keyed by asset symbol. */
    results: {},
    /** The most recent federal estimate, or null when it could not be produced. */
    taxEstimate: null,
    /** Addresses derived from the extended public key, if any were requested. */
    addresses: [],
    /** Notices surfaced to the user: engine warnings, import errors, validation failures. */
    notices: [],
    demoLoaded: false,
    keyInfo: null,
    vault: { available: false, reason: null, hasVault: false },
    settings: {
        asset: 'BTC',
        method: 'FIFO',
        applyWashSale: true,
        respectFrozen: true,
        taxYear: DEFAULT_TAX_YEAR,
        filingStatus: FILING_STATUS.SINGLE,
        otherIncome: '',
    },
});

export const NOTICE_LEVEL = Object.freeze({ INFO: 'info', WARNING: 'warning', ERROR: 'error' });

/** Adds a notice, collapsing exact duplicates so a re-run does not stack them. */
export const addNotice = (store, level, code, message) => {
    const exists = store.notices.some((notice) => notice.code === code && notice.message === message);
    if (!exists) store.notices.push({ level, code, message });
};

export const clearNotices = (store, predicate) => {
    store.notices = predicate ? store.notices.filter((notice) => !predicate(notice)) : [];
};

export const getLotState = (store, lotId) => store.lotState[lotId] || { frozen: false, label: '' };

export const setLotState = (store, lotId, patch) => {
    store.lotState[lotId] = { ...getLotState(store, lotId), ...patch };
};

/**
 * Drops annotation records that carry nothing — an unfrozen lot with a blank
 * label, or an emptied note — so the vault does not fill up with empty objects.
 *
 * It deliberately does NOT drop records whose lot is absent from the current
 * audit. Only the assets the user has loaded a history for appear in the
 * results, so pruning by "is this id live?" would delete every saved Ethereum
 * label the moment someone imported a Bitcoin-only CSV. Labels are user data:
 * a stale one costs a few bytes, a deleted one is gone for good. Clearing
 * everything deliberately is what "Forget saved labels" is for.
 */
export const pruneEmptyAnnotations = (store) => {
    for (const [id, entry] of Object.entries(store.lotState)) {
        if (!entry.frozen && !entry.label) delete store.lotState[id];
    }
    for (const [id, note] of Object.entries(store.txNotes)) {
        if (!note) delete store.txNotes[id];
    }
};

/**
 * What goes into the encrypted vault.
 *
 * The transaction history is included deliberately. A tax tool is opened once a
 * year; requiring the CSV to be re-imported on every launch would mean the
 * user's work never survives closing the window. It is encrypted at rest along
 * with everything else, and "Forget saved labels" clears it.
 *
 * Demo state never reaches here — `persist` refuses to write while the demo
 * profile is loaded.
 *
 * The extended public key is deliberately NOT saved. It is watch-only and
 * cannot spend, but it reveals every address and every transaction the wallet
 * has ever made, which makes it the most identifying thing the app handles.
 * It costs one paste to re-enter; leaving it off disk is the cheaper trade.
 */
const toPersistable = (store) => ({
    lotState: store.lotState,
    txNotes: store.txNotes,
    histories: store.histories,
    markPrices: store.markPrices,
    settings: {
        method: store.settings.method,
        asset: store.settings.asset,
        applyWashSale: store.settings.applyWashSale,
        respectFrozen: store.settings.respectFrozen,
        taxYear: store.settings.taxYear,
        filingStatus: store.settings.filingStatus,
    },
});

/**
 * Reads the vault and merges it into the store.
 * A missing or unreadable vault is reported, never fatal.
 */
export const hydrate = async (store) => {
    const api = bridge();
    if (!api) return { ok: false, reason: 'Running outside the desktop app; nothing will be saved.' };

    store.vault = await api.vault.status();
    if (!store.vault.available) return { ok: false, reason: store.vault.reason };

    const result = await api.vault.load();
    if (!result.ok) return { ok: false, reason: result.error };
    if (!result.exists || !result.payload) return { ok: true, restored: false };

    store.lotState = result.payload.lotState || {};
    store.txNotes = result.payload.txNotes || {};
    store.histories = result.payload.histories || {};
    store.markPrices = result.payload.markPrices || {};
    store.settings = { ...store.settings, ...result.payload.settings };
    if (!store.settings.taxYear) store.settings.taxYear = DEFAULT_TAX_YEAR;

    const transactionCount = Object.values(store.histories)
        .reduce((total, list) => total + (Array.isArray(list) ? list.length : 0), 0);

    return { ok: true, restored: true, transactionCount };
};

let saveTimer = null;

/**
 * Queues an encrypted save, coalescing rapid edits.
 * Returns a promise that settles when the write lands, or immediately when
 * there is nowhere safe to write.
 */
export const persist = (store) => {
    const api = bridge();
    if (!api || !store.vault.available) return Promise.resolve({ ok: false, skipped: true });

    // The demo profile is a session-only overlay. Writing while it is loaded
    // would either save sample data as though it were real, or overwrite a real
    // saved history with the empty one the demo replaced it with.
    if (store.demoLoaded) return Promise.resolve({ ok: false, skipped: true, reason: 'demo' });

    if (saveTimer) clearTimeout(saveTimer);

    return new Promise((resolve) => {
        saveTimer = setTimeout(async () => {
            saveTimer = null;
            resolve(await api.vault.save(toPersistable(store)));
        }, SAVE_DEBOUNCE_MS);
    });
};

/** Wipes every saved thing, in memory and on disk. */
export const forgetEverything = async (store) => {
    store.lotState = {};
    store.txNotes = {};
    store.histories = {};
    store.markPrices = {};
    store.results = {};
    store.addresses = [];
    store.taxEstimate = null;

    const api = bridge();
    if (!api) return { existed: false };
    return api.vault.clear();
};

export { bridge };
