/**
 * csv.js
 * RFC 4180 CSV writing with spreadsheet formula injection neutralised.
 *
 * Both matter here. A UTXO label containing a comma used to corrupt the export
 * silently, and a label beginning with `=` used to become a live formula in
 * whatever spreadsheet the user opened their tax report in.
 */

import { usdToDecimalString } from './money.js';
import { formatUnits } from './decimal.js';
import { TERM } from './holdingPeriod.js';

const DELIMITER = ',';
const LINE_ENDING = '\r\n';
/** Byte order mark, built from its code point so no invisible character sits in this source. */
const UTF8_BOM = String.fromCodePoint(0xfeff);

const TAB = '\t';

/** Leading characters a spreadsheet will interpret as the start of a formula. */
const FORMULA_LEADERS = new Set(['=', '+', '-', '@', TAB, '\r']);

/** A field that is plainly a number or a date is safe to leave alone. */
const SAFE_NUMERIC = /^-?\d+(\.\d+)?$/;
const SAFE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * C0/C1 control characters have no business in a CSV cell: they break row
 * framing and can hide content from anyone reviewing the export.
 *
 * Tab, line feed and carriage return are deliberately kept — quoting handles
 * them, and a leading tab is itself a formula leader worth detecting. Tested
 * by code point rather than by a regex literal so that no invisible character
 * has to survive a round trip through this source file.
 */
const isControlCodePoint = (code) => code <= 0x08
    || code === 0x0b
    || code === 0x0c
    || (code >= 0x0e && code <= 0x1f)
    || (code >= 0x7f && code <= 0x9f);

const stripControlCharacters = (text) => {
    let out = '';
    for (const char of text) {
        if (!isControlCodePoint(char.codePointAt(0))) out += char;
    }
    return out;
};

/**
 * Prefixes a formula-leading field with an apostrophe so spreadsheets treat it
 * as literal text. Genuine numbers and dates are exempt, so a negative gain
 * still imports as a number rather than a string.
 */
export const neutraliseFormula = (field) => {
    if (field === '') return field;
    if (SAFE_NUMERIC.test(field) || SAFE_DATE.test(field)) return field;
    return FORMULA_LEADERS.has(field[0]) ? `'${field}` : field;
};

/**
 * Escapes one field per RFC 4180: wrap in quotes when it contains a delimiter,
 * a quote, a line break or edge whitespace, and double any embedded quote.
 */
export const escapeField = (value) => {
    const raw = value === null || value === undefined ? '' : String(value);
    const safe = neutraliseFormula(stripControlCharacters(raw));

    const needsQuoting = safe.includes(DELIMITER)
        || safe.includes('"')
        || safe.includes('\n')
        || safe.includes('\r')
        || safe.includes(TAB)
        || safe !== safe.trim();

    return needsQuoting ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/**
 * Serialises rows to CSV text.
 *
 * @param {Array<string>} headers
 * @param {Array<Array<*>>} rows
 * @param {{bom?: boolean}} [options] - bom defaults true so Excel reads UTF-8 correctly
 */
export const toCsv = (headers, rows, options = {}) => {
    const { bom = true } = options;
    const lines = [headers, ...rows].map((row) => row.map(escapeField).join(DELIMITER));
    return `${bom ? UTF8_BOM : ''}${lines.join(LINE_ENDING)}${LINE_ENDING}`;
};

const FORM_8949_HEADERS = Object.freeze([
    'Term',
    '(a) Description of property',
    '(b) Date acquired',
    '(c) Date sold or disposed of',
    '(d) Proceeds',
    '(e) Cost or other basis',
    '(f) Code(s)',
    '(g) Amount of adjustment',
    '(h) Gain or (loss)',
]);

/** Column (f) adjustment codes. 'W' is the wash sale code from the 8949 instructions. */
const adjustmentCodes = (disposal) => (disposal.washSale ? 'W' : '');

const describeProperty = (disposal) => `${formatUnits(disposal.units, disposal.decimals)} ${disposal.asset}`;

/**
 * Builds a Form 8949 style export, one row per lot disposed.
 *
 * Column (g) carries the disallowed wash sale loss as a positive adjustment,
 * matching the IRS convention, and column (h) is the gain after it.
 *
 * @param {Array<object>} disposals - from the gains engine
 * @param {{bom?: boolean}} [options]
 */
export const buildForm8949Csv = (disposals, options = {}) => {
    const rows = disposals.map((disposal) => [
        disposal.term === TERM.LONG ? 'Long' : 'Short',
        describeProperty(disposal),
        disposal.acquiredDate || 'Various',
        disposal.soldDate,
        usdToDecimalString(disposal.proceedsCents),
        usdToDecimalString(disposal.basisCents),
        adjustmentCodes(disposal),
        disposal.disallowedLossCents > 0n ? usdToDecimalString(disposal.disallowedLossCents) : '',
        usdToDecimalString(disposal.gainCents),
    ]);

    return toCsv(FORM_8949_HEADERS, rows, options);
};

const AUDIT_HEADERS = Object.freeze([
    'Disposal ID',
    'Sale transaction',
    'Lot',
    'Asset',
    'Quantity',
    'Date acquired',
    'Date sold',
    'Days held',
    'Term',
    'Proceeds',
    'Cost basis',
    'Raw gain/loss',
    'Wash sale',
    'Disallowed loss',
    'Replacement lots',
    'Reported gain/loss',
    'Label',
    'Note',
    'Flags',
]);

const rowFlags = (disposal) => {
    const flags = [];
    if (disposal.isCoinJoin) flags.push('CoinJoin');
    if (disposal.isLightning) flags.push('Lightning channel');
    if (disposal.fromFrozenLot) flags.push('Frozen lot spent');
    return flags.join('; ');
};

/**
 * Builds the full working-paper export: every field the engine computed,
 * including the annotations the user added.
 *
 * @param {Array<object>} disposals
 * @param {{labels?: Object<string,string>, notes?: Object<string,string>, bom?: boolean}} [options]
 */
export const buildAuditCsv = (disposals, options = {}) => {
    const labels = options.labels || {};
    const notes = options.notes || {};

    const rows = disposals.map((disposal) => [
        disposal.id,
        disposal.txId,
        disposal.lotId || 'unmatched',
        disposal.asset,
        formatUnits(disposal.units, disposal.decimals),
        disposal.acquiredDate || '',
        disposal.soldDate,
        disposal.daysHeld,
        disposal.term === TERM.LONG ? 'Long' : 'Short',
        usdToDecimalString(disposal.proceedsCents),
        usdToDecimalString(disposal.basisCents),
        usdToDecimalString(disposal.rawGainCents),
        disposal.washSale ? 'Yes' : 'No',
        usdToDecimalString(disposal.disallowedLossCents),
        disposal.replacementLotIds.join('; '),
        usdToDecimalString(disposal.gainCents),
        labels[disposal.lotId] || '',
        notes[disposal.txId] || '',
        rowFlags(disposal),
    ]);

    return toCsv(AUDIT_HEADERS, rows, options);
};

export { FORM_8949_HEADERS, AUDIT_HEADERS };
