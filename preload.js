/**
 * preload.js
 * The only bridge between the renderer and the main process.
 *
 * `ipcRenderer` itself is never handed to the page. What the renderer gets is
 * this fixed set of named functions, so the attack surface is exactly the list
 * below rather than "any channel a bug can name".
 */

const { contextBridge, ipcRenderer } = require('electron');

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
 * Copies a value through JSON so nothing from the page's realm — a getter, a
 * proxy, a prototype-polluted object — crosses into the main process.
 *
 * Deliberately JSON rather than `structuredClone`: the round trip reduces the
 * value to plain JSON types, which is exactly what the IPC boundary can carry,
 * and it drops anything exotic instead of faithfully cloning it.
 */
const toPlain = (value) => JSON.parse(JSON.stringify(value ?? null));

const api = Object.freeze({
    getAppInfo: () => ipcRenderer.invoke(CHANNELS.APP_INFO),

    vault: Object.freeze({
        status: () => ipcRenderer.invoke(CHANNELS.VAULT_STATUS),
        load: () => ipcRenderer.invoke(CHANNELS.VAULT_LOAD),
        save: (payload) => ipcRenderer.invoke(CHANNELS.VAULT_SAVE, toPlain(payload)),
        clear: () => ipcRenderer.invoke(CHANNELS.VAULT_CLEAR),
    }),

    /**
     * @param {{filename: string, content: string}} request
     * @returns {Promise<{ok: boolean, canceled: boolean, path?: string}>}
     */
    exportCsv: (request) => ipcRenderer.invoke(CHANNELS.EXPORT_CSV, toPlain(request)),

    derive: Object.freeze({
        /** Whether address derivation passed its self-test in this build. */
        status: () => ipcRenderer.invoke(CHANNELS.DERIVE_STATUS),
        /**
         * @param {{extendedKey: string, chain?: number, start?: number, count?: number}} request
         * @returns {Promise<{ok: boolean, addresses?: Array<object>, error?: string}>}
         */
        addresses: (request) => ipcRenderer.invoke(CHANNELS.DERIVE_ADDRESSES, toPlain(request)),
    }),
});

contextBridge.exposeInMainWorld('bittax', api);
