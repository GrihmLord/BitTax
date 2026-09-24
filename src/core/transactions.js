/**
 * transactions.js
 * Validation and normalisation of raw trade history into the exact-integer
 * form the gains engine consumes. Nothing downstream re-parses user input.
 */

import { getAsset } from './assets.js';
import { parseUnits } from './decimal.js';
import { parsePrice, parseUSD, valueOf, priceFrom } from './money.js';

export const TX_TYPES = Object.freeze(['BUY', 'SELL']);

export const DAY_MS = 86400000;

/** Whole UTC days since the epoch. Every date rule in the engine works on these. */
export const dayNumber = (ms) => Math.floor(ms / DAY_MS);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * ISO 8601 date-time with an optional zone. A `T` or a single space may
 * separate the date from the time, since exchange exports use both. A value
 * with no zone is read as UTC, never as the auditor's local time.
 */
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/i;

/** US-style month/day/year, with an optional time. Day-first files fail loudly on day 13. */
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Builds a UTC timestamp and rejects any component that rolled over.
 * `Date.UTC(2023, 1, 30)` quietly becomes 2 March; a tax lot must not.
 */
const buildUtc = (text, year, month, day, hour = 0, minute = 0, second = 0, millis = 0) => {
    if (hour > 23 || minute > 59 || second > 59) throw new RangeError(`Time does not exist: ${text}`);
    const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis);
    const check = new Date(ms);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        throw new RangeError(`Date does not exist: ${text}`);
    }
    return ms;
};

/** Converts a zone designator into an offset in minutes east of UTC. */
const zoneOffsetMinutes = (zone) => {
    if (!zone || /^(z|utc)$/i.test(zone)) return 0;
    const digits = zone.replace(':', '');
    const sign = digits[0] === '-' ? -1 : 1;
    const hours = Number(digits.slice(1, 3));
    const minutes = Number(digits.slice(3, 5));
    if (hours > 23 || minutes > 59) throw new RangeError(`Invalid time zone offset: ${zone}`);
    return sign * (hours * 60 + minutes);
};

/**
 * Parses a calendar date or timestamp into epoch milliseconds.
 *
 * Accepted forms, all deterministic regardless of the machine's time zone:
 *   - `YYYY-MM-DD` (UTC midnight)
 *   - `YYYY-MM-DDTHH:MM[:SS[.fff]][Z|±HH:MM]` and the same with a space
 *   - `M/D/YYYY [HH:MM[:SS]]` (US order)
 *   - epoch milliseconds, or a valid `Date`
 *
 * Anything else is rejected. The previous fallback to `Date.parse` read
 * zone-less strings in local time, so the same file could put a lot in a
 * different tax year depending on where it was audited.
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

    let match = ISO_DATE.exec(text);
    if (match) return buildUtc(text, Number(match[1]), Number(match[2]), Number(match[3]));

    match = ISO_DATE_TIME.exec(text);
    if (match) {
        const [, y, mo, d, h, mi, s = '0', fraction = '0', zone] = match;
        const millis = Number(fraction.padEnd(3, '0').slice(0, 3));
        const local = buildUtc(text, Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s), millis);
        return local - zoneOffsetMinutes(zone) * 60000;
    }

    match = US_DATE.exec(text);
    if (match) {
        const [, mo, d, y, h = '0', mi = '0', s = '0'] = match;
        if (Number(mo) > 12) {
            throw new RangeError(`Date ${text} is not month/day/year. Convert day-first dates to YYYY-MM-DD before importing.`);
        }
        return buildUtc(text, Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s));
    }

    throw new TypeError(`Unrecognised date: ${text}. Use YYYY-MM-DD or an ISO 8601 timestamp.`);
};

/** Renders epoch milliseconds back as a UTC calendar date. */
export const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);

const isBlank = (value) => value === undefined || value === null || value === '';

const requireField = (tx, field, index) => {
    if (isBlank(tx[field])) {
        throw new TypeError(`Transaction #${index} is missing required field "${field}"`);
    }
    return tx[field];
};

/**
 * 64-bit string hash (two independently mixed 32-bit lanes, after cyrb53).
 * Ids need stability, not cryptographic strength: a collision between two
 * different rows is harmless, because `normaliseHistory` disambiguates any
 * repeated id with an occurrence suffix. SHA-256 here cost ~70% of the time
 * to audit a 100,000-row history.
 */
const hash64 = (text) => {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
};

/**
 * A content-derived id for a row that arrived without one.
 *
 * Coin-control state (freezes, labels) and notes are keyed by transaction id.
 * A positional id such as `tx-3` silently re-attaches a label to a different
 * purchase the moment a row is inserted above it; a hash of the row's economic
 * content does not move.
 */
export const contentId = (fields) => `tx-${hash64(
    [fields.type, fields.asset, fields.timestamp, fields.units, fields.grossCents, fields.feeCents].join('|'),
)}`;

/**
 * Normalises a single raw transaction.
 *
 * Consideration is given either as a unit `price` or as a `total` (quantity x
 * price, in dollars, before fees). A total is taken as-is, so an export that
 * reports what was actually paid is never re-derived through a rounded price.
 *
 * @param {object} tx - { id?, type, date, amount, price? | total?, fee?, asset?, isCoinJoin?, isLightning? }
 * @param {string} defaultAsset
 * @param {number} index - position in the source list, for error messages
 */
export const normaliseTransaction = (tx, defaultAsset, index) => {
    if (!tx || typeof tx !== 'object') throw new TypeError(`Transaction #${index} is not an object`);

    const type = String(requireField(tx, 'type', index)).toUpperCase();
    if (!TX_TYPES.includes(type)) {
        throw new RangeError(`Transaction #${index} has unknown type "${tx.type}". Expected ${TX_TYPES.join(' or ')}`);
    }

    const asset = getAsset(tx.asset || defaultAsset);
    const timestamp = parseDate(requireField(tx, 'date', index));
    const units = parseUnits(requireField(tx, 'amount', index), asset.decimals);
    if (units <= 0n) throw new RangeError(`Transaction #${index} has a non-positive amount`);

    let price;
    let grossCents;
    if (!isBlank(tx.total)) {
        grossCents = parseUSD(tx.total);
        if (grossCents < 0n) throw new RangeError(`Transaction #${index} has a negative total`);
        price = priceFrom(grossCents, units, asset.decimals);
    } else {
        if (isBlank(tx.price)) throw new TypeError(`Transaction #${index} needs a "price" or a "total"`);
        price = parsePrice(tx.price);
        if (price < 0n) throw new RangeError(`Transaction #${index} has a negative price`);
        grossCents = valueOf(units, asset.decimals, price);
    }

    const feeCents = isBlank(tx.fee) ? 0n : parseUSD(tx.fee);
    if (feeCents < 0n) throw new RangeError(`Transaction #${index} has a negative fee`);

    return {
        id: isBlank(tx.id) ? null : String(tx.id),
        type,
        asset: asset.symbol,
        decimals: asset.decimals,
        timestamp,
        day: dayNumber(timestamp),
        date: toISODate(timestamp),
        units,
        price,
        grossCents,
        feeCents,
        sequence: index,
        isCoinJoin: Boolean(tx.isCoinJoin),
        isLightning: Boolean(tx.isLightning),
    };
};

/**
 * Validates and sorts a raw history.
 *
 * Explicit ids must be unique. Rows without one get a content hash; two rows
 * with identical content (a genuine repeat purchase) are told apart by an
 * occurrence suffix in source order.
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
    const generatedCounts = new Map();

    const normalised = history.map((raw, index) => {
        const item = normaliseTransaction(raw, defaultAsset, index);

        if (item.id === null) {
            const base = contentId(item);
            const occurrence = (generatedCounts.get(base) || 0) + 1;
            generatedCounts.set(base, occurrence);
            item.id = occurrence === 1 ? base : `${base}#${occurrence}`;
        }

        if (seenIds.has(item.id)) {
            throw new RangeError(`Duplicate transaction id "${item.id}" at #${index}. Ids must be unique.`);
        }
        seenIds.add(item.id);
        return item;
    });

    return normalised.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
};
