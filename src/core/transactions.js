/**
 * transactions.js
 * Validation and normalisation of raw trade history into the exact-integer
 * form the gains engine consumes. Nothing downstream re-parses user input.
 */

import { getAsset } from './assets.js';
import { parseUnits } from './decimal.js';
import { parsePrice, parseUSD } from './money.js';

export const TX_TYPES = Object.freeze(['BUY', 'SELL']);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a calendar date or full ISO timestamp into epoch milliseconds.
 * Bare `YYYY-MM-DD` is anchored at UTC midnight so results do not shift with
 * the auditor's timezone — a tax lot must not change year because of DST.
 *
 * @param {string|number|Date} value
 * @returns {number} epoch milliseconds
 */
export const parseDate = (value) => {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new TypeError('Invalid Date object');
        return value.getTime();
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`Invalid timestamp: ${value}`);
        return value;
    }
    if (typeof value !== 'string') throw new TypeError(`Unsupported date type: ${typeof value}`);

    const text = value.trim();
    const match = ISO_DATE.exec(text);
    if (match) {
        const [, year, month, day] = match;
        const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
        const check = new Date(ms);
        if (check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) {
            throw new RangeError(`Date does not exist: ${text}`);
        }
        return ms;
    }

    const ms = Date.parse(text);
    if (Number.isNaN(ms)) throw new TypeError(`Unrecognised date: ${text}`);
    return ms;
};

/** Renders epoch milliseconds back as a UTC calendar date. */
export const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);

const requireField = (tx, field, index) => {
    if (tx[field] === undefined || tx[field] === null || tx[field] === '') {
        throw new TypeError(`Transaction #${index} is missing required field "${field}"`);
    }
    return tx[field];
};

/**
 * Normalises a single raw transaction.
 *
 * @param {object} tx - { id, type, date, amount, price, fee?, asset?, isCoinJoin?, isLightning? }
 * @param {string} defaultAsset
 * @param {number} index - position in the source list, for error messages
 */
const normaliseOne = (tx, defaultAsset, index) => {
    if (!tx || typeof tx !== 'object') throw new TypeError(`Transaction #${index} is not an object`);

    const type = String(requireField(tx, 'type', index)).toUpperCase();
    if (!TX_TYPES.includes(type)) {
        throw new RangeError(`Transaction #${index} has unknown type "${tx.type}". Expected ${TX_TYPES.join(' or ')}`);
    }

    const asset = getAsset(tx.asset || defaultAsset);
    const timestamp = parseDate(requireField(tx, 'date', index));
    const units = parseUnits(requireField(tx, 'amount', index), asset.decimals);
    if (units <= 0n) throw new RangeError(`Transaction #${index} has a non-positive amount`);

    const price = parsePrice(requireField(tx, 'price', index));
    if (price < 0n) throw new RangeError(`Transaction #${index} has a negative price`);

    const feeCents = tx.fee === undefined || tx.fee === null ? 0n : parseUSD(tx.fee);
    if (feeCents < 0n) throw new RangeError(`Transaction #${index} has a negative fee`);

    return {
        id: tx.id ? String(tx.id) : `tx-${index}-${toISODate(timestamp)}`,
        type,
        asset: asset.symbol,
        decimals: asset.decimals,
        timestamp,
        date: toISODate(timestamp),
        units,
        price,
        feeCents,
        sequence: index,
        isCoinJoin: Boolean(tx.isCoinJoin),
        isLightning: Boolean(tx.isLightning),
    };
};

/**
 * Validates and sorts a raw history.
 *
 * Ties on timestamp fall back to source order, so a same-day buy/sell pair keeps
 * the sequence the user recorded instead of depending on sort stability.
 *
 * @param {Array<object>} history
 * @param {string} defaultAsset
 * @returns {Array<object>} normalised, chronologically ordered transactions
 */
export const normaliseHistory = (history, defaultAsset) => {
    if (!Array.isArray(history)) throw new TypeError('History must be an array');

    const seenIds = new Set();
    const normalised = history.map((tx, index) => {
        const item = normaliseOne(tx, defaultAsset, index);
        if (seenIds.has(item.id)) {
            throw new RangeError(`Duplicate transaction id "${item.id}" at #${index}. Ids must be unique.`);
        }
        seenIds.add(item.id);
        return item;
    });

    return normalised.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
};
