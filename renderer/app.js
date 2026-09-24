/**
 * app.js
 * Renderer controller: reads the form, drives the audit core, renders results.
 *
 * It holds no calculation logic of its own. Every number on screen comes from
 * `src/core`, which is the same code the tests and the CLI verifiers use, so
 * the desktop app cannot drift away from the engine again.
 *
 * Figures on the Disposals tab, the estimate and the Form 8949 export are all
 * scoped to the selected tax year: a return covers one year, and summing every
 * sale ever made into one estimate was simply wrong.
 */

import { calculateGains, summariseDisposals } from '../src/core/gains.js';
import { buildForm8949Csv, buildAuditCsv } from '../src/core/csv.js';
import { estimateTax } from '../src/core/tax.js';
import { FILING_STATUS_LABELS, SUPPORTED_TAX_YEARS, TAX_YEARS, DEFAULT_TAX_YEAR } from '../src/core/taxTables.js';
import { SUPPORTED_ASSETS, getAsset } from '../src/core/assets.js';
import { COST_BASIS_METHODS } from '../src/core/lots.js';
import { parsePrice, parseUSD, valueOf } from '../src/core/money.js';
import { parseExtendedPublicKey, maskExtendedKey } from '../src/core/xpub.js';
import { detectSecretMaterial, SECRET_KIND } from '../src/core/secrets.js';
import { importTransactions, mergeHistories } from '../src/core/importCsv.js';
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

/** Parses an optional dollar amount that must not be negative; blank is zero. */
const optionalDollars = (raw, name) => {
    const text = String(raw || '').trim().replace(/[$,\s]/g, '');
    if (text === '') return 0n;
    const cents = parseUSD(text);
    if (cents < 0n) throw new RangeError(`${name} must not be negative`);
    return cents;
};

/** Notices raised by an import; they outlive re-runs of the audit until the next import. */
const IMPORT_CODES = new Set(['IMPORT_ERROR', 'IMPORT_SKIPPED', 'IMPORT_INCOME']);

const selectedYear = () => store.settings.taxYear;

const disposalsInYear = (result, year = selectedYear()) =>
    (result ? result.disposals.filter((disposal) => disposal.taxYear === year) : []);

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

/** Builds the federal estimate for the selected year, across every audited asset. */
const buildTaxEstimate = () => {
    const year = selectedYear();
    const totals = SUPPORTED_ASSETS.reduce((acc, asset) => {
        const summary = summariseDisposals(disposalsInYear(store.results[asset], year));
        return {
            shortTermGainCents: acc.shortTermGainCents + summary.shortTermGainCents,
            longTermGainCents: acc.longTermGainCents + summary.longTermGainCents,
        };
    }, { shortTermGainCents: 0n, longTermGainCents: 0n });

    if (!TAX_YEARS[year]) {
        addNotice(store, NOTICE_LEVEL.INFO, 'TAX_TABLE_MISSING',
            `BitTax has no rate table for ${year}, so no estimate is shown. Gains and the Form 8949 export are unaffected.`);
        return null;
    }

    try {
        return estimateTax({
            ordinaryIncomeCents: optionalDollars(store.settings.otherIncome, 'Other taxable income'),
            shortTermGainCents: totals.shortTermGainCents,
            longTermGainCents: totals.longTermGainCents,
            carryoverShortTermLossCents: optionalDollars(store.settings.carryoverShortTerm, 'Short-term carryover'),
            carryoverLongTermLossCents: optionalDollars(store.settings.carryoverLongTerm, 'Long-term carryover'),
            filingStatus: store.settings.filingStatus,
            year,
        });
    } catch (error) {
        addNotice(store, NOTICE_LEVEL.WARNING, 'TAX_ESTIMATE_UNAVAILABLE', error.message);
        return null;
    }
};

/**
 * Every year that has a rate table or a disposal, newest first. A year with
 * sales but no table can still be reviewed and exported.
 */
const availableYears = () => {
    const years = new Set(SUPPORTED_TAX_YEARS);
    for (const result of Object.values(store.results)) {
        for (const disposal of result ? result.disposals : []) years.add(disposal.taxYear);
    }
    years.add(selectedYear());
    return [...years].sort((a, b) => b - a);
};

const refreshYearSelect = () => {
    fillSelect('taxYearSelect', availableYears().map((year) => ({
        value: year,
        label: TAX_YEARS[year] ? String(year) : `${year} (no rate table)`,
    })), selectedYear());
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

    const disposals = disposalsInYear(result);
    const openLots = result ? result.openLots : [];

    renderDisposals(disposals, store.txNotes, handleNote, selectedYear());
    renderDisposalSummary(result ? summariseDisposals(disposals) : EMPTY_SUMMARY, result ? store.taxEstimate : null, selectedYear());
    renderLots(openLots, price, { onToggleFreeze: handleToggleFreeze, onLabel: handleLabel });
    renderLotSummary(openLots, price, decimals);

    renderDashboard(collectHoldings());
    renderNotices(store.notices);
    setExportEnabled({ form8949: disposals.length > 0, workingPaper: Boolean(result && result.disposals.length > 0) });
};

/** The main action: screen input, run every asset, estimate tax, render. */
const runAudit = () => {
    clearNotices(store, (notice) => !IMPORT_CODES.has(notice.code) && notice.code !== 'SAVE_FAILED');
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
    refreshYearSelect();
    store.taxEstimate = buildTaxEstimate();
    noteTaxTableProvenance(store.taxEstimate);

    pruneEmptyAnnotations(store);
    render();
    setStatus(`Audited ${audited.join(' and ')} · ${store.settings.method} · ${describeWashSetting()} · showing ${selectedYear()}.`, 'ok');
};

const describeWashSetting = () => (store.settings.applyWashSale ? 'wash sale rule applied' : 'wash sale rule off');

/* --- annotation handlers -------------------------------------------- */

/**
 * Saves, and says so when the save did not land. A silent failure here means
 * the user closes the app believing their labels are kept.
 */
const save = async () => {
    const outcome = await persist(store);
    if (outcome.ok || outcome.skipped) return;
    addNotice(store, NOTICE_LEVEL.ERROR, 'SAVE_FAILED', `Your changes were not saved: ${outcome.error || 'unknown error'}`);
    renderNotices(store.notices);
    setStatus('Save failed — see Notices.', 'error');
};

/**
 * Refuses annotation text that carries spending authority. A bare 64-digit
 * hex string is allowed: in a note it is almost always a transaction id.
 *
 * @returns {boolean} whether the text may be stored
 */
const screenAnnotation = (text) => {
    const secret = detectSecretMaterial(text);
    if (!secret || secret.kind === SECRET_KIND.RAW_PRIVATE_KEY) return true;
    setText('secretBannerText', secret.message);
    setHidden('secretBanner', false);
    setStatus('That text was not saved — see the warning above.', 'error');
    return false;
};

function handleNote(txId, note, input) {
    if ((store.txNotes[txId] || '') === note) return;
    if (!screenAnnotation(note)) { input.value = store.txNotes[txId] || ''; return; }
    store.txNotes[txId] = note;
    save();
}

function handleLabel(originId, label, input) {
    if (getLotState(store, originId).label === label) return;
    if (!screenAnnotation(label)) { input.value = getLotState(store, originId).label; return; }
    setLotState(store, originId, { label });
    // Every tranche of the purchase shows the same label; no re-audit needed.
    for (const result of Object.values(store.results)) {
        for (const lot of result ? result.lots : []) if (lot.originId === originId) lot.label = label;
    }
    save();
    render();
}

/**
 * Freezing changes which lots the engine may select, so the audit is re-run
 * with the user's real settings. State is keyed by the purchase, so freezing
 * a wash-adjusted tranche freezes the whole purchase it came from.
 */
function handleToggleFreeze(originId) {
    setLotState(store, originId, { frozen: !getLotState(store, originId).frozen });
    save();
    runAudit();
    showTab('utxo');
}

/* --- import / export ------------------------------------------------ */

const handleImport = async (file) => {
    if (!file) return;

    try {
        const text = await file.text();
        const { byAsset, errors, skipped, incomeCount, imported } = importTransactions(text, { defaultAsset: currentAsset() });

        clearNotices(store, (notice) => IMPORT_CODES.has(notice.code));
        reportRows('IMPORT_ERROR', NOTICE_LEVEL.WARNING, errors, 'rows were rejected');
        reportRows('IMPORT_SKIPPED', NOTICE_LEVEL.INFO, skipped.map((entry) => entry.message), 'rows were skipped');
        if (incomeCount > 0) {
            addNotice(store, NOTICE_LEVEL.WARNING, 'IMPORT_INCOME',
                `${incomeCount} income receipt${incomeCount === 1 ? '' : 's'} (staking, rewards, mining) became lots at market value. `
                + 'That value is ordinary income for the year received; add it to "Other taxable income".');
        }

        if (imported === 0) {
            setStatus('Nothing imported — no row was a purchase or sale. See notices.', 'error');
            render();
            return;
        }

        // A demo overlay is replaced, never merged into: sample data must not
        // end up in the user's saved history.
        const base = store.demoLoaded ? {} : store.histories;
        const { histories, added, duplicates } = mergeHistories(base, byAsset);

        store.histories = histories;
        store.demoLoaded = false;
        store.addresses = [];
        renderAddresses([]);
        setHidden('demoBanner', true);
        // Saved encrypted so the history survives closing the app; a tax tool
        // that forgets everything on exit is one people re-import into yearly.
        save();
        const duplicateNote = duplicates > 0 ? `; ${duplicates} already present` : '';
        setStatus(`Imported ${added} new transaction${added === 1 ? '' : 's'}${duplicateNote}.`, 'ok');
        runAudit();
    } catch (error) {
        addNotice(store, NOTICE_LEVEL.ERROR, 'IMPORT_FAILED', error.message);
        setStatus(`Import failed: ${error.message}`, 'error');
        render();
    }
};

const MAX_ROW_NOTICES = 20;

const reportRows = (code, level, messages, summary) => {
    for (const message of messages.slice(0, MAX_ROW_NOTICES)) addNotice(store, level, code, message);
    if (messages.length > MAX_ROW_NOTICES) {
        addNotice(store, level, code, `…and ${messages.length - MAX_ROW_NOTICES} more ${summary}.`);
    }
};

/**
 * Form 8949 is filed per year, so it exports the selected year only. The
 * working paper is the full history, for a preparer reviewing every lot.
 */
const handleExport = async (kind) => {
    const result = store.results[currentAsset()];
    const asset = currentAsset().toLowerCase();
    const year = selectedYear();
    const disposals = kind === '8949' ? disposalsInYear(result, year) : (result ? result.disposals : []);
    if (disposals.length === 0) return;

    const content = kind === '8949'
        ? buildForm8949Csv(disposals)
        : buildAuditCsv(disposals, { labels: labelMap(), notes: store.txNotes });

    const filename = kind === '8949' ? `bittax_${asset}_${year}_8949.csv` : `bittax_${asset}_working_paper.csv`;

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

    // Show the demo's most recent sales rather than an empty current year.
    // Nothing persists while the demo is loaded, so the user's saved year is safe.
    store.settings.taxYear = Math.max(...DEMO_HISTORY.BTC.concat(DEMO_HISTORY.ETH)
        .filter((tx) => tx.type === 'SELL')
        .map((tx) => Number(tx.date.slice(0, 4))));

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
    refreshYearSelect();
    fillSelect('filingStatusSelect',
        Object.entries(FILING_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        store.settings.filingStatus);
};

const applySettingsToForm = () => {
    byId('washSaleToggle').checked = store.settings.applyWashSale;
    byId('respectFrozenToggle').checked = store.settings.respectFrozen;
    byId('otherIncomeInput').value = store.settings.otherIncome || '';
    byId('carryoverShortInput').value = store.settings.carryoverShortTerm || '';
    byId('carryoverLongInput').value = store.settings.carryoverLongTerm || '';
    byId('markPriceInput').value = store.markPrices[currentAsset()] || '';
};

/** A setting changed: record it, save it, and re-run if results already exist. */
const onSettingChanged = (patch, { rerun = true } = {}) => {
    Object.assign(store.settings, patch);
    save();
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

    byId('otherIncomeInput').addEventListener('change', (event) => onDollarSettingChanged('otherIncome', event.target, 'Other taxable income'));
    byId('carryoverShortInput').addEventListener('change', (event) => onDollarSettingChanged('carryoverShortTerm', event.target, 'Short-term carryover'));
    byId('carryoverLongInput').addEventListener('change', (event) => onDollarSettingChanged('carryoverLongTerm', event.target, 'Long-term carryover'));
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

/** Validates a dollar field before it is stored, so a typo is caught where it was typed. */
const onDollarSettingChanged = (key, input, name) => {
    const raw = input.value.trim();
    try {
        optionalDollars(raw, name);
    } catch (error) {
        setStatus(`${name} rejected: ${error.message}`, 'error');
        input.value = store.settings[key] || '';
        return;
    }
    onSettingChanged({ [key]: raw });
};

const onMarkPriceChanged = (raw) => {
    try {
        optionalPrice(raw);
    } catch (error) {
        setStatus(`Mark price rejected: ${error.message}`, 'error');
        return;
    }
    store.markPrices[currentAsset()] = raw;
    save();
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

    // A restored year need not have a rate table — a year with sales but no
    // table can still be reviewed and exported — but it must be a year.
    if (!Number.isInteger(store.settings.taxYear)) store.settings.taxYear = DEFAULT_TAX_YEAR;

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
