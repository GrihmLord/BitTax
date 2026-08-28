/**
 * app.js
 * Renderer controller: reads the form, drives the audit core, renders results.
 *
 * It holds no calculation logic of its own. Every number on screen comes from
 * `src/core`, which is the same code the tests and the React Native screens
 * use, so the desktop app cannot drift away from the engine again.
 */

import { calculateGains } from '../src/core/gains.js';
import { buildForm8949Csv, buildAuditCsv } from '../src/core/csv.js';
import { estimateTax } from '../src/core/tax.js';
import { FILING_STATUS_LABELS, SUPPORTED_TAX_YEARS, getTaxYear } from '../src/core/taxTables.js';
import { SUPPORTED_ASSETS, getAsset } from '../src/core/assets.js';
import { COST_BASIS_METHODS } from '../src/core/lots.js';
import { parsePrice, parseUSD, valueOf } from '../src/core/money.js';
import { parseExtendedPublicKey, maskExtendedKey } from '../src/core/xpub.js';
import { detectSecretMaterial } from '../src/core/secrets.js';
import { importTransactions } from '../src/core/importCsv.js';
import { DEMO_HISTORY, DEMO_MARK_PRICES, DEMO_KEY_PLACEHOLDER, isDemoKey } from './demoProfile.js';
import { byId, setText, setHidden } from './dom.js';
import {
    createStore, addNotice, clearNotices, getLotState, setLotState, pruneEmptyAnnotations,
    hydrate, persist, forgetEverything, bridge, NOTICE_LEVEL,
} from './store.js';
import {
    fillSelect, renderDisposals, renderDisposalSummary, renderLots, renderLotSummary,
    renderDashboard, renderNotices, setStatus, showTab, setVaultBadge, setExportEnabled,
    renderAddresses, setDeriveAvailability,
} from './views.js';

const store = createStore();

/* --- helpers -------------------------------------------------------- */

/** Parses an optional decimal money field, returning null when blank. */
const optionalPrice = (raw) => {
    const text = String(raw || '').trim();
    if (text === '') return null;
    return parsePrice(text);
};

const currentAsset = () => store.settings.asset;

const historyFor = (asset) => store.histories[asset] || [];

/**
 * The user's current price for an asset, or null when none is set.
 * Rendering must never throw on a bad stored value, so a malformed price
 * degrades to "unpriced" rather than taking the whole view down.
 */
const markPriceFor = (asset) => {
    const raw = store.markPrices[asset];
    if (raw === undefined || raw === null || raw === '') return null;
    try {
        return parsePrice(raw);
    } catch {
        return null;
    }
};

/** Zeroed summary so the stat row resets instead of holding stale figures. */
const EMPTY_SUMMARY = Object.freeze({
    disposalCount: 0,
    shortTermGainCents: 0n,
    longTermGainCents: 0n,
    netGainCents: 0n,
});

/* --- audit ---------------------------------------------------------- */

/**
 * Screens the key field. A valid extended key is parsed and reported; spending
 * material is refused outright and never stored.
 *
 * @returns {boolean} whether it is safe to proceed
 */
const screenKeyInput = () => {
    const raw = byId('keyInput').value.trim();
    setHidden('secretBanner', true);
    store.keyInfo = null;

    if (raw === '' || isDemoKey(raw)) return true;

    const secret = detectSecretMaterial(raw);
    if (secret) {
        byId('keyInput').value = '';
        setText('secretBannerText', secret.message);
        setHidden('secretBanner', false);
        addNotice(store, NOTICE_LEVEL.ERROR, secret.kind, secret.message);
        setStatus('Input rejected — see the notice above.', 'error');
        return false;
    }

    try {
        store.keyInfo = parseExtendedPublicKey(raw);
        addNotice(store, NOTICE_LEVEL.INFO, 'KEY_ACCEPTED',
            `${maskExtendedKey(raw)} parsed as a ${store.keyInfo.label} key (${store.keyInfo.network}, BIP${store.keyInfo.purpose}).`);
    } catch (error) {
        // A non-extended-key value is legitimate: the user may be auditing an
        // imported history and pasted a plain address for their own reference.
        addNotice(store, NOTICE_LEVEL.WARNING, 'KEY_NOT_PARSED',
            `That value is not a valid extended public key (${error.message}). The audit will run on the imported history.`);
    }
    return true;
};

/** Runs the engine for one asset and stores the result. */
const auditAsset = (asset) => {
    const history = historyFor(asset);
    if (history.length === 0) {
        store.results[asset] = null;
        return;
    }

    store.results[asset] = calculateGains(history, {
        asset,
        method: store.settings.method,
        applyWashSale: store.settings.applyWashSale,
        respectFrozen: store.settings.respectFrozen,
        lotState: store.lotState,
    });
};

/** Collects the per-asset holdings the dashboard needs. */
const collectHoldings = () => SUPPORTED_ASSETS
    .map((asset) => {
        const result = store.results[asset];
        if (!result || result.openLots.length === 0) return null;

        const decimals = getAsset(asset).decimals;
        const units = result.openLots.reduce((total, lot) => total + lot.units, 0n);
        const basisCents = result.openLots.reduce((total, lot) => total + lot.basisCents, 0n);
        const price = markPriceFor(asset);

        return { asset, units, basisCents, valueCents: price === null ? null : valueOf(units, decimals, price) };
    })
    .filter(Boolean);

/** Builds the federal estimate across every audited asset. */
const buildTaxEstimate = () => {
    const totals = SUPPORTED_ASSETS.reduce((acc, asset) => {
        const result = store.results[asset];
        if (!result) return acc;
        return {
            shortTermGainCents: acc.shortTermGainCents + result.summary.shortTermGainCents,
            longTermGainCents: acc.longTermGainCents + result.summary.longTermGainCents,
        };
    }, { shortTermGainCents: 0n, longTermGainCents: 0n });

    try {
        return estimateTax({
            ordinaryIncomeCents: store.settings.otherIncome ? parseUSD(store.settings.otherIncome) : 0n,
            shortTermGainCents: totals.shortTermGainCents,
            longTermGainCents: totals.longTermGainCents,
            filingStatus: store.settings.filingStatus,
            year: store.settings.taxYear,
        });
    } catch (error) {
        addNotice(store, NOTICE_LEVEL.WARNING, 'TAX_ESTIMATE_UNAVAILABLE', error.message);
        return null;
    }
};

/** Turns engine warnings into user-visible notices. */
const surfaceEngineWarnings = () => {
    for (const asset of SUPPORTED_ASSETS) {
        const result = store.results[asset];
        if (!result) continue;
        for (const warning of result.warnings) {
            addNotice(store, NOTICE_LEVEL.WARNING, warning.code, warning.message);
        }
    }
};

const noteTaxTableProvenance = (estimate) => {
    if (!estimate || estimate.verified) return;
    addNotice(store, NOTICE_LEVEL.WARNING, 'TAX_TABLE_UNVERIFIED',
        `The ${estimate.year} rate table (${estimate.source}) ships unverified. Confirm the brackets before filing.`);
};

/** Full render pass. Safe to call after any state change. */
const render = () => {
    const asset = currentAsset();
    const result = store.results[asset];
    const decimals = getAsset(asset).decimals;
    const price = markPriceFor(asset);

    const disposals = result ? result.disposals : [];
    const openLots = result ? result.openLots : [];

    renderDisposals(disposals, store.txNotes, handleNote);
    renderDisposalSummary(result ? result.summary : EMPTY_SUMMARY, result ? store.taxEstimate : null);
    renderLots(openLots, price, { onToggleFreeze: handleToggleFreeze, onLabel: handleLabel });
    renderLotSummary(openLots, price, decimals);

    renderDashboard(collectHoldings());
    renderNotices(store.notices);
    setExportEnabled(Boolean(result && result.disposals.length > 0));
};

/** The main action: screen input, run every asset, estimate tax, render. */
const runAudit = () => {
    clearNotices(store, (notice) => notice.code !== 'IMPORT_ERROR');
    if (!screenKeyInput()) { render(); return; }

    const audited = SUPPORTED_ASSETS.filter((asset) => historyFor(asset).length > 0);
    if (audited.length === 0) {
        setStatus('No transaction history loaded. Import a CSV, or load the demo profile.', 'error');
        render();
        return;
    }

    try {
        // Every supported asset is re-audited, not just the ones with history:
        // an asset whose history was replaced by a new import must have its
        // previous result cleared, or the dashboard keeps showing holdings that
        // nothing backs any more.
        for (const asset of SUPPORTED_ASSETS) auditAsset(asset);
    } catch (error) {
        addNotice(store, NOTICE_LEVEL.ERROR, 'AUDIT_FAILED', error.message);
        setStatus(`Audit failed: ${error.message}`, 'error');
        render();
        return;
    }

    surfaceEngineWarnings();
    store.taxEstimate = buildTaxEstimate();
    noteTaxTableProvenance(store.taxEstimate);

    pruneEmptyAnnotations(store);
    render();
    setStatus(`Audited ${audited.join(' and ')} · ${store.settings.method} · ${describeWashSetting()}.`, 'ok');
};

const describeWashSetting = () => (store.settings.applyWashSale ? 'wash sale rule applied' : 'wash sale rule off');

/* --- annotation handlers -------------------------------------------- */

function handleNote(txId, note) {
    if ((store.txNotes[txId] || '') === note) return;
    store.txNotes[txId] = note;
    persist(store);
}

function handleLabel(lotId, label) {
    if (getLotState(store, lotId).label === label) return;
    setLotState(store, lotId, { label });
    persist(store);
}

/**
 * Freezing changes which lots the engine may select, so the audit is re-run
 * with the user's real settings — the old build re-ran in demo mode and
 * silently swapped the user's data for sample data.
 */
function handleToggleFreeze(lotId) {
    setLotState(store, lotId, { frozen: !getLotState(store, lotId).frozen });
    persist(store);
    runAudit();
    showTab('utxo');
}

/* --- import / export ------------------------------------------------ */

const handleImport = async (file) => {
    if (!file) return;

    try {
        const text = await file.text();
        const { byAsset, errors, imported } = importTransactions(text, { defaultAsset: currentAsset() });

        clearNotices(store, (notice) => notice.code === 'IMPORT_ERROR');
        for (const message of errors.slice(0, 20)) addNotice(store, NOTICE_LEVEL.WARNING, 'IMPORT_ERROR', message);
        if (errors.length > 20) {
            addNotice(store, NOTICE_LEVEL.WARNING, 'IMPORT_ERROR', `…and ${errors.length - 20} more rows were skipped.`);
        }

        if (imported === 0) {
            setStatus('Nothing imported — every row was rejected. See notices.', 'error');
            render();
            return;
        }

        store.histories = byAsset;
        store.demoLoaded = false;
        store.addresses = [];
        renderAddresses([]);
        setHidden('demoBanner', true);
        // Saved encrypted so the history survives closing the app; a tax tool
        // that forgets everything on exit is one people re-import into yearly.
        persist(store);
        setStatus(`Imported ${imported} transaction${imported === 1 ? '' : 's'} across ${Object.keys(byAsset).join(', ')}.`, 'ok');
        runAudit();
    } catch (error) {
        addNotice(store, NOTICE_LEVEL.ERROR, 'IMPORT_FAILED', error.message);
        setStatus(`Import failed: ${error.message}`, 'error');
        render();
    }
};

const handleExport = async (kind) => {
    const result = store.results[currentAsset()];
    if (!result || result.disposals.length === 0) return;

    const content = kind === '8949'
        ? buildForm8949Csv(result.disposals)
        : buildAuditCsv(result.disposals, { labels: labelMap(), notes: store.txNotes });

    const filename = kind === '8949'
        ? `bittax_${currentAsset().toLowerCase()}_8949.csv`
        : `bittax_${currentAsset().toLowerCase()}_working_paper.csv`;

    const api = bridge();
    if (!api) {
        setStatus('Export needs the desktop app.', 'error');
        return;
    }

    try {
        const outcome = await api.exportCsv({ filename, content });
        if (outcome.canceled) { setStatus('Export cancelled.'); return; }
        setStatus(outcome.ok ? `Saved to ${outcome.path}` : 'Export failed.', outcome.ok ? 'ok' : 'error');
    } catch (error) {
        // The main process rejects on validation failure or a write error.
        addNotice(store, NOTICE_LEVEL.ERROR, 'EXPORT_FAILED', error.message);
        setStatus(`Export failed: ${error.message}`, 'error');
        renderNotices(store.notices);
    }
};

const labelMap = () => Object.fromEntries(
    Object.entries(store.lotState).map(([id, state]) => [id, state.label || '']),
);

/* --- address derivation --------------------------------------------- */

/** Reads a non-negative integer field, falling back when it is not one. */
const readIndex = (id, fallback) => {
    const raw = byId(id).value.trim();
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
};

/**
 * Expands the extended public key into addresses.
 *
 * The main process runs a self-test over its curve arithmetic and encodings
 * before it will derive anything, so a failure here means "BitTax does not
 * trust this build to produce addresses", not "no addresses exist".
 */
const handleDerive = async () => {
    const api = bridge();
    if (!api) {
        setStatus('Address derivation needs the desktop app.', 'error');
        return;
    }

    const extendedKey = byId('keyInput').value.trim();
    if (extendedKey === '' || isDemoKey(extendedKey)) {
        setStatus('Enter a real extended public key to derive addresses.', 'error');
        return;
    }

    setStatus('Deriving…');
    const result = await api.derive.addresses({
        extendedKey,
        chain: Number(byId('deriveChainSelect').value) === 1 ? 1 : 0,
        start: readIndex('deriveStartInput', 0),
        count: readIndex('deriveCountInput', 20),
    });

    if (!result.ok) {
        addNotice(store, NOTICE_LEVEL.ERROR, result.name || 'DERIVE_FAILED', result.error);
        setStatus(`Could not derive addresses: ${result.error}`, 'error');
        renderAddresses([]);
        renderNotices(store.notices);
        return;
    }

    store.addresses = result.addresses;
    renderAddresses(result.addresses);
    setStatus(
        `Derived ${result.addresses.length} ${result.key.script} address${result.addresses.length === 1 ? '' : 'es'} `
        + `on the ${result.chain === 1 ? 'change' : 'receive'} chain.`,
        'ok',
    );
};

/** Asks the main process whether derivation passed its self-test. */
const checkDerivation = async () => {
    const api = bridge();
    if (!api) {
        setDeriveAvailability({ available: false, failures: ['Derivation needs the desktop app.'] });
        return;
    }

    try {
        const status = await api.derive.status();
        setDeriveAvailability(status);
        if (!status.available && status.failures.length > 0) {
            addNotice(store, NOTICE_LEVEL.WARNING, 'DERIVATION_UNAVAILABLE',
                `Address derivation is disabled: ${status.failures.join('; ')}`);
        }
    } catch (error) {
        setDeriveAvailability({ available: false, failures: [error.message] });
    }
};

/* --- demo ----------------------------------------------------------- */

const loadDemoProfile = () => {
    store.histories = { BTC: [...DEMO_HISTORY.BTC], ETH: [...DEMO_HISTORY.ETH] };
    store.markPrices = { ...DEMO_MARK_PRICES };
    store.demoLoaded = true;
    store.addresses = [];
    renderAddresses([]);

    byId('keyInput').value = DEMO_KEY_PLACEHOLDER;
    byId('markPriceInput').value = DEMO_MARK_PRICES[currentAsset()] || '';
    setHidden('demoBanner', false);

    runAudit();
    showTab('dashboard');
};

/* --- wiring --------------------------------------------------------- */

const populateSelects = () => {
    fillSelect('assetSelect', SUPPORTED_ASSETS.map((asset) => ({ value: asset, label: getAsset(asset).name })), store.settings.asset);
    fillSelect('methodSelect', COST_BASIS_METHODS.map((method) => ({ value: method, label: method })), store.settings.method);
    fillSelect('taxYearSelect', SUPPORTED_TAX_YEARS.map((year) => ({ value: year, label: String(year) })), store.settings.taxYear);
    fillSelect('filingStatusSelect',
        Object.entries(FILING_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        store.settings.filingStatus);
};

const applySettingsToForm = () => {
    byId('washSaleToggle').checked = store.settings.applyWashSale;
    byId('respectFrozenToggle').checked = store.settings.respectFrozen;
    byId('otherIncomeInput').value = store.settings.otherIncome || '';
    byId('markPriceInput').value = store.markPrices[currentAsset()] || '';
};

/** A setting changed: record it, save it, and re-run if results already exist. */
const onSettingChanged = (patch, { rerun = true } = {}) => {
    Object.assign(store.settings, patch);
    persist(store);
    if (rerun && Object.keys(store.results).length > 0) runAudit();
    else render();
};

const wireEvents = () => {
    byId('auditButton').addEventListener('click', runAudit);
    byId('demoButton').addEventListener('click', loadDemoProfile);

    byId('importButton').addEventListener('click', () => byId('importInput').click());
    byId('importInput').addEventListener('change', (event) => {
        handleImport(event.target.files[0]);
        event.target.value = '';
    });

    byId('export8949Button').addEventListener('click', () => handleExport('8949'));
    byId('exportAuditButton').addEventListener('click', () => handleExport('audit'));

    byId('assetSelect').addEventListener('change', (event) => {
        store.settings.asset = event.target.value;
        byId('markPriceInput').value = store.markPrices[event.target.value] || '';
        onSettingChanged({});
    });

    byId('methodSelect').addEventListener('change', (event) => onSettingChanged({ method: event.target.value }));
    byId('taxYearSelect').addEventListener('change', (event) => onSettingChanged({ taxYear: Number(event.target.value) }));
    byId('filingStatusSelect').addEventListener('change', (event) => onSettingChanged({ filingStatus: event.target.value }));
    byId('washSaleToggle').addEventListener('change', (event) => onSettingChanged({ applyWashSale: event.target.checked }));
    byId('respectFrozenToggle').addEventListener('change', (event) => onSettingChanged({ respectFrozen: event.target.checked }));

    byId('otherIncomeInput').addEventListener('change', (event) => onSettingChanged({ otherIncome: event.target.value.trim() }));
    byId('markPriceInput').addEventListener('change', (event) => onMarkPriceChanged(event.target.value.trim()));

    byId('forgetButton').addEventListener('click', handleForget);
    byId('deriveButton').addEventListener('click', handleDerive);

    // Addresses belong to whichever key produced them; a new key invalidates them.
    byId('keyInput').addEventListener('input', () => {
        if (store.addresses.length === 0) return;
        store.addresses = [];
        renderAddresses([]);
    });

    byId('tabs').addEventListener('click', (event) => {
        // `closest` rather than `event.target.dataset`: the Notices tab contains
        // a count badge, and clicking the badge would otherwise do nothing.
        const tab = event.target.closest?.('.tab');
        if (tab && tab.dataset.view) showTab(tab.dataset.view);
    });
};

const onMarkPriceChanged = (raw) => {
    try {
        optionalPrice(raw);
    } catch (error) {
        setStatus(`Mark price rejected: ${error.message}`, 'error');
        return;
    }
    store.markPrices[currentAsset()] = raw;
    persist(store);
    render();
};

const handleForget = async () => {
    await forgetEverything(store);
    clearNotices(store);
    addNotice(store, NOTICE_LEVEL.INFO, 'VAULT_CLEARED',
        'Everything saved on this machine was deleted: transaction history, labels, freezes and notes.');

    byId('keyInput').value = '';
    byId('markPriceInput').value = '';
    setHidden('demoBanner', true);
    renderAddresses([]);
    render();
    setStatus('Saved data cleared.', 'ok');
};

/* --- startup -------------------------------------------------------- */

const showAppInfo = async () => {
    const api = bridge();
    if (!api) {
        setText('versionBadge', 'browser preview');
        return;
    }
    try {
        const info = await api.getAppInfo();
        setText('versionBadge', `v${info.version}`);
    } catch {
        setText('versionBadge', 'version unknown');
    }
};

/**
 * Last-resort handler. Startup wires every control, so a failure part-way
 * through leaves a page that looks fine and responds to nothing. Say so rather
 * than presenting a dead UI.
 */
const reportFatal = (error) => {
    console.error('[bittax] startup failed:', error);
    try {
        setStatus(`BitTax failed to start: ${error.message}. Restart the app; if it persists, report this.`, 'error');
    } catch {
        document.body.textContent = `BitTax failed to start: ${error.message}`;
    }
};

const start = async () => {
    const outcome = await hydrate(store);
    setVaultBadge(store.vault);

    if (!outcome.ok && outcome.reason) {
        addNotice(store, NOTICE_LEVEL.WARNING, 'VAULT_UNAVAILABLE', outcome.reason);
    }

    // A restored tax year must still exist in the shipped tables.
    try {
        getTaxYear(store.settings.taxYear);
    } catch {
        store.settings.taxYear = SUPPORTED_TAX_YEARS[0];
    }

    populateSelects();
    applySettingsToForm();
    wireEvents();
    await showAppInfo();
    await checkDerivation();

    // A restored history is audited straight away, so reopening the app lands on
    // the numbers rather than on an empty form.
    const restoredCount = outcome.transactionCount || 0;
    if (restoredCount > 0) {
        runAudit();
        setStatus(`Restored ${restoredCount} saved transaction${restoredCount === 1 ? '' : 's'}.`, 'ok');
        return;
    }

    render();
    setStatus(outcome.restored
        ? 'Saved settings restored. Import a history, or load the demo profile to begin.'
        : 'Import a transaction history CSV, or load the demo profile to begin.');
};

start().catch(reportFatal);
