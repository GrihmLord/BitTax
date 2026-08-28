/**
 * views.js
 * Pure rendering. Every function here takes data and writes it into the DOM
 * through `dom.js`, which never interprets a value as markup.
 */

import { el, byId, setText, setHidden, replaceChildren, cell, editableCell, tag } from './dom.js';
import { formatUSD, valueOf, percentOf, ratioOf } from '../src/core/money.js';
import { formatUnits } from '../src/core/decimal.js';
import { getAsset } from '../src/core/assets.js';
import { TERM } from '../src/core/holdingPeriod.js';
import { formatRateBp } from '../src/core/tax.js';

const EM_DASH = '—';

/** Applies the gain/loss colour without branching in three places. */
const signClass = (cents) => (cents < 0n ? 'loss' : 'gain');

const moneyCell = (cents, { colour = false } = {}) => {
    const classes = colour ? ['num', signClass(cents)] : ['num'];
    return cell(formatUSD(cents), classes.join(' '));
};

const quantityCell = (units, decimals) => cell(formatUnits(units, decimals), 'num');

/** Populates a `<select>` from `[{value, label}]`. */
export const fillSelect = (id, options, selected) => {
    const node = byId(id);
    replaceChildren(node, options.map((option) => el('option', {
        text: option.label,
        attrs: { value: option.value, selected: String(option.value) === String(selected) },
    })));
    node.value = String(selected);
};

/* --- disposals ------------------------------------------------------ */

const disposalFlags = (disposal) => {
    const flags = [tag(disposal.term === TERM.LONG ? 'LONG' : 'SHORT', disposal.term === TERM.LONG ? 'long' : 'short')];
    if (disposal.washSale) flags.push(tag('WASH SALE', 'wash'));
    if (disposal.isCoinJoin) flags.push(tag('COINJOIN', 'coinjoin'));
    if (disposal.isLightning) flags.push(tag('LN CHANNEL', 'lightning'));
    if (disposal.fromFrozenLot) flags.push(tag('FROZEN SPENT', 'frozen'));
    return el('td', {}, flags);
};

/**
 * @param {Array<object>} disposals
 * @param {Object<string,string>} notes
 * @param {(txId: string, note: string) => void} onNote
 */
export const renderDisposals = (disposals, notes, onNote) => {
    const body = byId('disposalsBody');

    replaceChildren(body, disposals.map((disposal) => el('tr', {}, [
        cell(disposal.soldDate),
        cell(disposal.acquiredDate || 'Unmatched'),
        cell(disposal.daysHeld === undefined ? EM_DASH : `${disposal.daysHeld}d`),
        quantityCell(disposal.units, disposal.decimals),
        moneyCell(disposal.proceedsCents),
        moneyCell(disposal.basisCents),
        moneyCell(disposal.gainCents, { colour: true }),
        disposalFlags(disposal),
        editableCell(notes[disposal.txId] || '', 'Add a note', (value) => onNote(disposal.txId, value)),
    ])));

    setHidden('disposalsEmpty', disposals.length > 0);
};

export const renderDisposalSummary = (summary, taxEstimate) => {
    setText('stDisposals', String(summary.disposalCount));
    setText('stShortTerm', formatUSD(summary.shortTermGainCents));
    setText('stLongTerm', formatUSD(summary.longTermGainCents));
    setText('stNet', formatUSD(summary.netGainCents));

    byId('stShortTerm').className = `stat__value ${signClass(summary.shortTermGainCents)}`;
    byId('stLongTerm').className = `stat__value ${signClass(summary.longTermGainCents)}`;
    byId('stNet').className = `stat__value ${signClass(summary.netGainCents)}`;

    if (!taxEstimate) {
        setText('stTax', EM_DASH);
        setText('stTaxLabel', 'Estimated federal tax');
        return;
    }

    setText('stTax', formatUSD(taxEstimate.totalTaxCents));
    setText('stTaxLabel', `Est. federal tax · ${taxEstimate.year} · marginal ${formatRateBp(taxEstimate.marginalOrdinaryRateBp)}`);
};

/* --- UTXO manager --------------------------------------------------- */

const freezeButton = (lot, onToggle) => el('td', {}, [
    el('button', {
        class: 'button button--ghost button--small',
        text: lot.frozen ? 'Unfreeze' : 'Freeze',
        on: { click: () => onToggle(lot.id) },
    }),
]);

/**
 * @param {Array<object>} lots - open lots from the engine
 * @param {bigint|null} markPrice
 * @param {{onToggleFreeze: Function, onLabel: Function}} handlers
 */
export const renderLots = (lots, markPrice, handlers) => {
    const body = byId('utxoBody');

    replaceChildren(body, lots.map((lot) => {
        const value = markPrice === null ? null : valueOf(lot.units, lot.decimals, markPrice);
        const row = el('tr', {}, [
            cell(lot.frozen ? 'Frozen' : 'Active'),
            cell(lot.acquiredDate),
            quantityCell(lot.units, lot.decimals),
            moneyCell(lot.basisCents),
            value === null ? cell(EM_DASH, 'num') : moneyCell(value),
            editableCell(lot.label || '', 'e.g. KYC-free', (text) => handlers.onLabel(lot.id, text)),
            freezeButton(lot, handlers.onToggleFreeze),
        ]);
        if (lot.frozen) row.classList.add('is-frozen');
        return row;
    }));

    setHidden('utxoEmpty', lots.length > 0);
};

export const renderLotSummary = (lots, markPrice, decimals) => {
    const units = lots.reduce((total, lot) => total + lot.units, 0n);
    const basis = lots.reduce((total, lot) => total + lot.basisCents, 0n);

    setText('utxoCount', String(lots.length));
    setText('utxoQuantity', formatUnits(units, decimals));
    setText('utxoBasis', formatUSD(basis));
    setText('utxoValue', markPrice === null ? EM_DASH : formatUSD(valueOf(units, decimals, markPrice)));
};

/* --- dashboard ------------------------------------------------------ */

/**
 * @param {Array<{asset:string, units:bigint, basisCents:bigint, valueCents:bigint|null}>} holdings
 */
export const renderDashboard = (holdings) => {
    const priced = holdings.filter((holding) => holding.valueCents !== null);
    const totalValue = priced.reduce((total, holding) => total + holding.valueCents, 0n);
    const totalBasis = holdings.reduce((total, holding) => total + holding.basisCents, 0n);
    const unpriced = holdings.length - priced.length;

    const hasValue = priced.length > 0 && totalValue > 0n;
    setText('dbNetWorth', hasValue ? formatUSD(totalValue) : EM_DASH);
    setText('dbCostBasis', formatUSD(totalBasis));

    if (hasValue) {
        const unrealised = totalValue - totalBasis;
        setText('dbUnrealized', formatUSD(unrealised));
        byId('dbUnrealized').className = `stat__value ${signClass(unrealised)}`;
        setText('dbRoi', percentOf(unrealised, totalBasis) ?? EM_DASH);
    } else {
        setText('dbUnrealized', EM_DASH);
        byId('dbUnrealized').className = 'stat__value';
        setText('dbRoi', EM_DASH);
    }

    renderHoldingsTable(holdings, totalValue);
    renderAllocation(priced, totalValue);
    setText('allocationHint', describeUnpriced(unpriced));
};

/** "2 holdings excluded…" — pluralised without nesting ternaries inline. */
const describeUnpriced = (count) => {
    if (count === 0) return '';
    const noun = count === 1 ? 'holding' : 'holdings';
    const pronoun = count === 1 ? 'it' : 'them';
    return `${count} ${noun} excluded: enter a mark price to include ${pronoun}.`;
};

const renderHoldingsTable = (holdings, totalValue) => {
    replaceChildren(byId('holdingsBody'), holdings.map((holding) => el('tr', {}, [
        cell(holding.asset),
        quantityCell(holding.units, getAsset(holding.asset).decimals),
        moneyCell(holding.basisCents),
        holding.valueCents === null ? cell(EM_DASH, 'num') : moneyCell(holding.valueCents),
        cell(holding.valueCents === null ? EM_DASH : (percentOf(holding.valueCents, totalValue) ?? EM_DASH), 'num'),
    ])));
};

const renderAllocation = (priced, totalValue) => {
    const bar = byId('allocationBar');
    const legend = byId('allocationLegend');

    if (priced.length === 0 || totalValue <= 0n) {
        replaceChildren(bar, []);
        replaceChildren(legend, [el('li', { text: 'No priced holdings yet.' })]);
        return;
    }

    replaceChildren(bar, priced.map((holding) => {
        const segment = el('div', { class: 'allocation__segment', attrs: { title: holding.asset } });
        // Widths are applied through the CSSOM, which CSP does not restrict,
        // rather than through a style attribute, which it does.
        segment.style.setProperty('width', `${(ratioOf(holding.valueCents, totalValue) * 100).toFixed(2)}%`);
        segment.style.setProperty('background', getAsset(holding.asset).color);
        return segment;
    }));

    replaceChildren(legend, priced.map((holding) => {
        const swatch = el('span', { class: 'legend__swatch' });
        swatch.style.setProperty('background', getAsset(holding.asset).color);
        return el('li', {}, [
            swatch,
            el('span', { text: holding.asset }),
            el('span', { class: 'legend__value', text: percentOf(holding.valueCents, totalValue) ?? EM_DASH }),
        ]);
    }));
};

/* --- derived addresses ---------------------------------------------- */

/**
 * @param {Array<{path:string, address:string, publicKey:string}>} addresses
 */
export const renderAddresses = (addresses) => {
    replaceChildren(byId('addressesBody'), addresses.map((entry) => el('tr', {}, [
        cell(entry.path, 'mono'),
        el('td', { class: 'mono' }, [el('span', { text: entry.address, attrs: { title: entry.address } })]),
        el('td', { class: 'mono' }, [
            el('span', { class: 'truncate', text: entry.publicKey, attrs: { title: entry.publicKey } }),
        ]),
    ])));

    setHidden('addressesEmpty', addresses.length > 0);
};

/** Explains why derivation is unavailable, when its self-test did not pass. */
export const setDeriveAvailability = (status) => {
    const button = byId('deriveButton');
    button.disabled = !status.available;

    if (status.available) return;
    setText('deriveIntro', status.failures.length > 0
        ? `Address derivation is disabled: ${status.failures.join('; ')}`
        : 'Address derivation is unavailable in this build.');
};

/* --- notices -------------------------------------------------------- */

export const renderNotices = (notices) => {
    replaceChildren(byId('noticesList'), notices.map((notice) => el('li', { class: `notice notice--${notice.level}` }, [
        el('span', { class: 'notice__code', text: notice.code }),
        el('span', { text: notice.message }),
    ])));

    setHidden('noticesEmpty', notices.length > 0);

    const count = byId('noticeCount');
    count.textContent = String(notices.length);
    count.classList.toggle('pill--alert', notices.some((notice) => notice.level !== 'info'));
};

/* --- chrome --------------------------------------------------------- */

export const setStatus = (message, kind = '') => {
    const node = byId('statusLine');
    node.textContent = message;
    node.className = kind ? `status status--${kind}` : 'status';
};

const VIEWS = ['dashboard', 'audit', 'utxo', 'addresses', 'notices'];

export const showTab = (view) => {
    for (const name of VIEWS) {
        setHidden(`view-${name}`, name !== view);
    }
    for (const button of document.querySelectorAll('.tab')) {
        button.classList.toggle('is-active', button.dataset.view === view);
    }
};

export const setVaultBadge = (vault) => {
    const node = byId('vaultBadge');
    node.textContent = vault.available ? 'Vault: encrypted' : 'Vault: unavailable';
    node.classList.toggle('badge--warn', !vault.available);
    node.title = vault.available
        ? 'Labels and freezes are encrypted with your OS keystore.'
        : (vault.reason || 'Nothing will be written to disk.');
};

export const setExportEnabled = (enabled) => {
    byId('export8949Button').disabled = !enabled;
    byId('exportAuditButton').disabled = !enabled;
};
