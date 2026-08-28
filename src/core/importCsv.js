/**
 * importCsv.js
 * Imports a trade history from a CSV export.
 *
 * Until now the tool could only ever audit its own built-in sample data: there
 * was no path for a real history to enter it at all. Wallets and exchanges all
 * export CSV, so this is the route that makes the audit usable on real
 * holdings without the app needing network access.
 *
 * Parsing is deliberately strict about values and forgiving about layout:
 * column names are matched against known aliases, and a row that cannot be
 * understood is reported with its line number rather than silently dropped.
 */

import { SUPPORTED_ASSETS, isSupportedAsset } from './assets.js';

const QUOTE = '"';

/**
 * RFC 4180 parser. Handles quoted fields, escaped quotes, embedded newlines,
 * and both CRLF and LF line endings.
 *
 * @param {string} text
 * @returns {Array<Array<string>>}
 */
export const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let index = 0;

    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    const endField = () => { row.push(field); field = ''; };
    const endRow = () => { endField(); rows.push(row); row = []; };

    while (index < source.length) {
        const char = source[index];

        if (inQuotes) {
            if (char === QUOTE) {
                if (source[index + 1] === QUOTE) { field += QUOTE; index += 2; continue; }
                inQuotes = false; index += 1; continue;
            }
            field += char; index += 1; continue;
        }

        if (char === QUOTE && field === '') { inQuotes = true; index += 1; continue; }
        if (char === ',') { endField(); index += 1; continue; }
        if (char === '\r') { index += 1; continue; }
        if (char === '\n') { endRow(); index += 1; continue; }

        field += char;
        index += 1;
    }

    if (field !== '' || row.length > 0) endRow();
    return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
};

/** Column aliases, lowercased and stripped of non-alphanumerics before matching. */
const COLUMN_ALIASES = Object.freeze({
    date: ['date', 'timestamp', 'time', 'datetime', 'dateacquired', 'datesold', 'tradedate', 'executedat'],
    type: ['type', 'side', 'action', 'transactiontype', 'operation', 'direction'],
    amount: ['amount', 'quantity', 'qty', 'units', 'size', 'volume', 'amountcrypto'],
    price: ['price', 'unitprice', 'pricepercoin', 'priceperunit', 'rate', 'spotprice', 'usdprice'],
    fee: ['fee', 'fees', 'commission', 'feeusd', 'transactionfee'],
    asset: ['asset', 'symbol', 'currency', 'coin', 'ticker', 'basecurrency'],
    id: ['id', 'txid', 'transactionid', 'reference', 'hash', 'txhash'],
});

const BUY_WORDS = new Set(['buy', 'bought', 'purchase', 'acquire', 'acquired', 'receive', 'received', 'deposit', 'in', 'credit']);
const SELL_WORDS = new Set(['sell', 'sold', 'sale', 'dispose', 'disposed', 'send', 'sent', 'withdraw', 'withdrawal', 'out', 'debit']);

const canonical = (header) => String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Maps the header row onto our field names.
 *
 * @param {Array<string>} headers
 * @returns {{map: Object<string,number>, missing: Array<string>}}
 */
export const mapColumns = (headers) => {
    const normalised = headers.map(canonical);
    const map = {};

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        const index = normalised.findIndex((header) => aliases.includes(header));
        if (index !== -1) map[field] = index;
    }

    const missing = ['date', 'type', 'amount', 'price'].filter((field) => map[field] === undefined);
    return { map, missing };
};

const normaliseType = (raw) => {
    const word = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
    if (BUY_WORDS.has(word)) return 'BUY';
    if (SELL_WORDS.has(word)) return 'SELL';
    return null;
};

/** Strips currency symbols, thousands separators and parenthesised negatives. */
const cleanNumber = (raw) => {
    const text = String(raw || '').trim();
    if (text === '') return '';
    const negative = /^\(.*\)$/.test(text);
    const stripped = text.replace(/[()]/g, '').replace(/[$£€\s,]/g, '');
    return negative ? `-${stripped}` : stripped;
};

/**
 * Converts one data row into a raw transaction for the gains engine.
 * Returns an error string instead of throwing so one bad row does not abort
 * the whole import.
 */
const rowToTransaction = (row, map, lineNumber, defaultAsset) => {
    const at = (field) => (map[field] === undefined ? '' : (row[map[field]] || '').trim());

    const type = normaliseType(at('type'));
    if (!type) return { error: `Line ${lineNumber}: unrecognised transaction type "${at('type')}"` };

    const amount = cleanNumber(at('amount'));
    if (amount === '') return { error: `Line ${lineNumber}: missing amount` };

    const price = cleanNumber(at('price'));
    if (price === '') return { error: `Line ${lineNumber}: missing price` };

    const asset = at('asset') ? at('asset').toUpperCase() : defaultAsset;
    if (!isSupportedAsset(asset)) {
        return { error: `Line ${lineNumber}: unsupported asset "${asset}". Supported: ${SUPPORTED_ASSETS.join(', ')}` };
    }

    return {
        transaction: {
            id: at('id') || `import-${lineNumber}`,
            type,
            date: at('date'),
            amount,
            price,
            fee: cleanNumber(at('fee')) || '0',
            asset,
        },
    };
};

/**
 * Imports a CSV export into transactions grouped by asset.
 *
 * @param {string} text - raw file contents
 * @param {{defaultAsset?: string, maxRows?: number}} [options]
 * @returns {{byAsset: Object<string,Array>, errors: Array<string>, imported: number, columns: object}}
 */
export const importTransactions = (text, options = {}) => {
    const { defaultAsset = 'BTC', maxRows = 100000 } = options;
    const rows = parseCsv(text);

    if (rows.length === 0) throw new Error('The file is empty');
    if (rows.length - 1 > maxRows) throw new Error(`The file holds more than ${maxRows} rows`);

    const [headers, ...dataRows] = rows;
    const { map, missing } = mapColumns(headers);
    if (missing.length > 0) {
        throw new Error(
            `Could not find a column for: ${missing.join(', ')}. `
            + `Header row was: ${headers.join(', ')}`,
        );
    }

    const byAsset = {};
    const errors = [];
    const seenIds = new Set();
    let imported = 0;

    dataRows.forEach((row, index) => {
        const lineNumber = index + 2;
        const { transaction, error } = rowToTransaction(row, map, lineNumber, defaultAsset);
        if (error) { errors.push(error); return; }

        // Exchanges routinely repeat an order id across partial fills. The engine
        // requires unique ids, so a collision is disambiguated by line rather
        // than rejected — the original id stays visible in the suffix.
        if (seenIds.has(transaction.id)) transaction.id = `${transaction.id}#L${lineNumber}`;
        seenIds.add(transaction.id);

        if (!byAsset[transaction.asset]) byAsset[transaction.asset] = [];
        byAsset[transaction.asset].push(transaction);
        imported += 1;
    });

    return { byAsset, errors, imported, columns: map };
};
