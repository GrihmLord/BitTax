/**
 * importCsv.js
 * Imports a trade history from a CSV export.
 *
 * Parsing is strict about values and forgiving about layout: column names are
 * matched against known aliases, a preamble above the header row is skipped,
 * and every row is validated exactly as the gains engine will read it. A row
 * that cannot be understood is reported with its line number rather than
 * silently dropped — or, worse, left to abort the whole audit later.
 *
 * Classification is deliberately conservative. Moving coins between your own
 * wallets is not a sale, and receiving them back is not a purchase; treating a
 * "Send" or "Withdrawal" as a disposal invents a taxable gain, and treating the
 * matching "Receive" as an acquisition invents a second lot. Transfer rows are
 * therefore skipped and listed, never guessed at.
 */

import { SUPPORTED_ASSETS, isSupportedAsset } from './assets.js';
import { normaliseTransaction, contentId } from './transactions.js';

const QUOTE = '"';

/** How far down the file the header row is looked for. */
const HEADER_SEARCH_ROWS = 25;

/**
 * RFC 4180 parser. Handles quoted fields, escaped quotes, embedded newlines,
 * and both CRLF and LF line endings. Each row records the physical line it
 * started on, so errors point at the line a spreadsheet shows.
 *
 * @param {string} text
 * @returns {Array<Array<string>>} rows, each with a non-enumerable `line`
 */
export const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let index = 0;
    let line = 1;
    let rowLine = 1;

    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    const endField = () => { row.push(field); field = ''; };
    const endRow = () => {
        endField();
        Object.defineProperty(row, 'line', { value: rowLine, enumerable: false });
        rows.push(row);
        row = [];
        rowLine = line;
    };

    while (index < source.length) {
        const char = source[index];
        if (char === '\n') line += 1;

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

    if (inQuotes) throw new Error(`Unterminated quoted field starting on line ${rowLine}`);
    if (field !== '' || row.length > 0) endRow();
    return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
};

/** Column aliases, lowercased and stripped of non-alphanumerics before matching. */
const COLUMN_ALIASES = Object.freeze({
    date: ['date', 'timestamp', 'time', 'datetime', 'tradedate', 'executedat', 'createdat', 'dateutc', 'timeutc'],
    type: ['type', 'side', 'action', 'transactiontype', 'operation', 'direction', 'kind'],
    amount: ['amount', 'quantity', 'qty', 'units', 'size', 'volume', 'amountcrypto', 'quantitytransacted', 'filledquantity'],
    price: ['price', 'unitprice', 'pricepercoin', 'priceperunit', 'rate', 'spotprice', 'usdprice', 'spotpriceattransaction', 'priceattransaction', 'priceusd'],
    total: ['subtotal', 'total', 'totalusd', 'value', 'valueusd', 'cost', 'proceeds', 'usdamount', 'amountusd'],
    fee: ['fee', 'fees', 'commission', 'feeusd', 'transactionfee', 'feesandorspread'],
    asset: ['asset', 'symbol', 'currency', 'coin', 'ticker', 'basecurrency'],
    currency: ['pricecurrency', 'spotpricecurrency', 'quotecurrency', 'fiatcurrency', 'nativecurrency'],
    id: ['id', 'txid', 'transactionid', 'reference', 'hash', 'txhash', 'orderid', 'tradeid'],
});

const REQUIRED = Object.freeze(['date', 'type', 'amount']);

const BUY_WORDS = new Set(['buy', 'bought', 'purchase', 'purchased', 'acquire', 'acquired', 'advancedtradebuy', 'marketbuy', 'limitbuy']);
const SELL_WORDS = new Set(['sell', 'sold', 'sale', 'dispose', 'disposed', 'advancedtradesell', 'marketsell', 'limitsell']);
/**
 * Receipts that are income, not transfers: the coins are acquired at fair
 * market value, which becomes their basis (Rev. Rul. 2023-14 for staking).
 */
const INCOME_WORDS = new Set([
    'reward', 'rewards', 'rewardsincome', 'stakingincome', 'staking', 'stakingreward', 'interest', 'income',
    'mining', 'miningreward', 'airdrop', 'learningreward', 'coinbaseearn', 'earn', 'inflationreward',
]);
const TRANSFER_WORDS = new Set([
    'send', 'sent', 'receive', 'received', 'deposit', 'withdraw', 'withdrawal', 'transfer', 'in', 'out',
    'credit', 'debit', 'transferin', 'transferout',
]);
/** Crypto-to-crypto swaps are two legs; a single row cannot carry both. */
const SWAP_WORDS = new Set(['convert', 'converted', 'swap', 'exchange', 'trade']);

const canonical = (header) => String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Maps a header row onto our field names.
 *
 * @param {Array<string>} headers
 * @returns {{map: Object<string,number>, missing: Array<string>}}
 */
export const mapColumns = (headers) => {
    const normalised = headers.map(canonical);
    const map = {};

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        // Earliest alias wins, so "Subtotal" beats a later "Total incl. fees".
        for (const alias of aliases) {
            const index = normalised.indexOf(alias);
            if (index !== -1 && !Object.values(map).includes(index)) { map[field] = index; break; }
        }
    }

    const missing = REQUIRED.filter((field) => map[field] === undefined);
    if (map.price === undefined && map.total === undefined) missing.push('price or total');
    return { map, missing };
};

/** Finds the header row, skipping the preamble some exchanges put above it. */
const locateHeader = (rows) => {
    let best = null;
    for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i += 1) {
        const mapped = mapColumns(rows[i]);
        if (mapped.missing.length === 0) return { index: i, ...mapped };
        if (!best || mapped.missing.length < best.missing.length) best = { index: i, ...mapped };
    }
    return best;
};

/** @returns {'BUY'|'SELL'|'INCOME'|'TRANSFER'|'SWAP'|null} */
export const classifyType = (raw) => {
    const word = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
    if (BUY_WORDS.has(word)) return 'BUY';
    if (SELL_WORDS.has(word)) return 'SELL';
    if (INCOME_WORDS.has(word)) return 'INCOME';
    if (TRANSFER_WORDS.has(word)) return 'TRANSFER';
    if (SWAP_WORDS.has(word)) return 'SWAP';
    return null;
};

/**
 * Strips currency symbols, thousands separators and parenthesised negatives,
 * and drops the sign: direction comes from the type column, and exchanges
 * disagree about whether a sale's quantity is written negative.
 */
const cleanNumber = (raw) => {
    const text = String(raw || '').trim();
    if (text === '') return '';
    return text.replace(/[()$£€\s,+-]/g, '').replace(/^(usd|us\$)/i, '').replace(/(usd)$/i, '');
};

const skip = (lineNumber, kind, reason) => ({ skipped: { line: lineNumber, kind, message: `Line ${lineNumber}: ${reason}` } });
const reject = (lineNumber, reason) => ({ error: `Line ${lineNumber}: ${reason}` });

/**
 * Converts one data row into a raw transaction for the gains engine, validated
 * exactly as the engine will read it.
 */
const rowToTransaction = (row, map, lineNumber, defaultAsset) => {
    const at = (field) => (map[field] === undefined ? '' : (row[map[field]] || '').trim());

    const rawType = at('type');
    const kind = classifyType(rawType);
    if (kind === 'TRANSFER') {
        return skip(lineNumber, 'TRANSFER', `"${rawType}" is a transfer between wallets, not a purchase or sale, and was not imported`);
    }
    if (kind === 'SWAP') {
        return skip(lineNumber, 'SWAP', `"${rawType}" is a crypto-to-crypto swap. Enter it as a SELL of one asset and a BUY of the other`);
    }
    if (!kind) return reject(lineNumber, `unrecognised transaction type "${rawType}"`);

    const currency = at('currency').toUpperCase();
    if (currency && currency !== 'USD') {
        return reject(lineNumber, `prices are in ${currency}; BitTax needs US dollar values`);
    }

    const amount = cleanNumber(at('amount'));
    if (amount === '') return reject(lineNumber, 'missing amount');

    const price = cleanNumber(at('price'));
    const total = cleanNumber(at('total'));
    if (price === '' && total === '') return reject(lineNumber, 'missing price');

    const asset = at('asset') ? at('asset').toUpperCase() : defaultAsset;
    if (!isSupportedAsset(asset)) {
        return reject(lineNumber, `unsupported asset "${asset}". Supported: ${SUPPORTED_ASSETS.join(', ')}`);
    }

    const transaction = {
        id: at('id') || null,
        type: kind === 'INCOME' ? 'BUY' : kind,
        date: at('date'),
        amount,
        fee: cleanNumber(at('fee')) || '0',
        asset,
    };
    // A unit price is preferred: a "total" column is ambiguous about whether
    // fees are already inside it. It is used only when no price exists.
    if (price !== '') transaction.price = price;
    else transaction.total = total;
    if (kind === 'INCOME') transaction.isIncome = true;

    try {
        normaliseTransaction(transaction, defaultAsset, lineNumber);
    } catch (error) {
        return reject(lineNumber, error.message.replace(/^Transaction #\d+ /, ''));
    }

    return { transaction, income: kind === 'INCOME' };
};

/**
 * Imports a CSV export into transactions grouped by asset.
 *
 * @param {string} text - raw file contents
 * @param {{defaultAsset?: string, maxRows?: number}} [options]
 * @returns {{
 *   byAsset: Object<string,Array>, errors: Array<string>, skipped: Array<object>,
 *   incomeCount: number, imported: number, columns: object, headerLine: number
 * }}
 */
export const importTransactions = (text, options = {}) => {
    const { defaultAsset = 'BTC', maxRows = 100000 } = options;
    if (typeof text !== 'string') throw new TypeError('CSV content must be text');
    const rows = parseCsv(text);

    if (rows.length === 0) throw new Error('The file is empty');
    if (rows.length - 1 > maxRows) throw new Error(`The file holds more than ${maxRows} rows`);

    const header = locateHeader(rows);
    if (header.missing.length > 0) {
        throw new Error(
            `Could not find a column for: ${header.missing.join(', ')}. `
            + `Header row was: ${rows[header.index].join(', ')}`,
        );
    }

    const byAsset = {};
    const errors = [];
    const skipped = [];
    const seenIds = new Set();
    let imported = 0;
    let incomeCount = 0;

    for (const row of rows.slice(header.index + 1)) {
        const lineNumber = row.line;
        const outcome = rowToTransaction(row, header.map, lineNumber, defaultAsset);
        if (outcome.error) { errors.push(outcome.error); continue; }
        if (outcome.skipped) { skipped.push(outcome.skipped); continue; }

        const { transaction } = outcome;
        // Exchanges routinely repeat an order id across partial fills. The engine
        // requires unique ids, so a collision is disambiguated by line rather
        // than rejected — the original id stays visible in the suffix.
        if (transaction.id !== null) {
            if (seenIds.has(transaction.id)) transaction.id = `${transaction.id}#L${lineNumber}`;
            seenIds.add(transaction.id);
        } else {
            delete transaction.id;
        }

        if (!byAsset[transaction.asset]) byAsset[transaction.asset] = [];
        byAsset[transaction.asset].push(transaction);
        imported += 1;
        if (outcome.income) incomeCount += 1;
    }

    return { byAsset, errors, skipped, incomeCount, imported, columns: header.map, headerLine: rows[header.index].line };
};

/** Identity used to recognise the same row across two imports. */
const mergeKey = (tx, asset) => {
    if (tx.id) return `id:${tx.id}`;
    try {
        return `content:${contentId(normaliseTransaction(tx, asset, 0))}`;
    } catch {
        // An unreadable stored row still needs a stable identity; the engine reports it.
        return `raw:${JSON.stringify(tx)}`;
    }
};

/**
 * Merges newly imported rows into an existing history without duplicating any.
 *
 * Re-importing the same export, or two overlapping exports, must not double a
 * position. Rows are matched by explicit id where they have one and by
 * economic content otherwise. Identical content is treated as a multiset: a
 * file with two genuinely identical purchases keeps both, and re-importing it
 * still yields two, not four.
 *
 * @param {Object<string,Array>} existing - history by asset
 * @param {Object<string,Array>} incoming - history by asset
 * @returns {{histories: Object<string,Array>, added: number, duplicates: number}}
 */
export const mergeHistories = (existing, incoming) => {
    const histories = {};
    let added = 0;
    let duplicates = 0;

    const assets = new Set([...Object.keys(existing || {}), ...Object.keys(incoming || {})]);
    for (const asset of assets) {
        const current = [...((existing || {})[asset] || [])];
        const counts = new Map();
        for (const tx of current) {
            const key = mergeKey(tx, asset);
            counts.set(key, (counts.get(key) || 0) + 1);
        }

        const seenIncoming = new Map();
        for (const tx of (incoming || {})[asset] || []) {
            const key = mergeKey(tx, asset);
            const occurrence = (seenIncoming.get(key) || 0) + 1;
            seenIncoming.set(key, occurrence);
            if (occurrence <= (counts.get(key) || 0)) { duplicates += 1; continue; }
            current.push(tx);
            added += 1;
        }

        if (current.length > 0) histories[asset] = current;
    }

    return { histories, added, duplicates };
};
