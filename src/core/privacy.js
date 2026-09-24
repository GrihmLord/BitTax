/**
 * privacy.js
 * Heuristics that flag transactions whose on-chain shape carries privacy or
 * classification consequences for an audit.
 *
 * These are heuristics, not proofs. Every result carries a confidence and a
 * human-readable reason so a preparer can judge it rather than trust a
 * bare boolean.
 */

import { parseUnits } from './decimal.js';
import { bech32Decode, convertBits, BECH32_CONST } from './bech32.js';

const SATOSHI_DECIMALS = 8;

export const CONFIDENCE = Object.freeze({ NONE: 'NONE', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

export const COINJOIN_DEFAULTS = Object.freeze({
    minInputs: 5,
    minOutputs: 5,
    minEqualOutputs: 3,
});

/**
 * Normalises an output value to integer satoshis.
 *
 * Grouping equal outputs is the whole basis of CoinJoin detection, and
 * grouping by a float means 0.1 and 0.1 can land in different buckets. Values
 * already expressed as integer base units are passed through.
 */
const toSats = (output) => {
    if (typeof output.valueSats === 'bigint') return output.valueSats;
    if (typeof output.valueSats === 'number') return Number.isSafeInteger(output.valueSats) ? BigInt(output.valueSats) : null;
    if (output.value === undefined || output.value === null) return null;
    try {
        return parseUnits(output.value, SATOSHI_DECIMALS);
    } catch {
        return null;
    }
};

/** Returns the largest group of identically-valued outputs. */
const largestEqualOutputGroup = (outputs) => {
    const counts = new Map();
    for (const output of outputs) {
        const sats = toSats(output);
        if (sats === null) continue;
        const key = sats.toString();
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    let bestValue = null;
    let bestCount = 0;
    for (const [key, count] of counts) {
        if (count > bestCount) {
            bestCount = count;
            bestValue = key;
        }
    }
    return { value: bestValue, count: bestCount };
};

const gradeCoinJoin = (equalCount, inputCount) => {
    if (equalCount >= 5 && equalCount >= inputCount) return CONFIDENCE.HIGH;
    if (equalCount >= 5) return CONFIDENCE.MEDIUM;
    return CONFIDENCE.LOW;
};

/**
 * Analyses a transaction for a CoinJoin / mixer pattern: many participants,
 * and a block of outputs all paying exactly the same amount.
 *
 * @param {{inputs?:Array, outputs?:Array}} tx
 * @param {object} [options] - overrides for COINJOIN_DEFAULTS
 * @returns {{isCoinJoin:boolean, confidence:string, anonymitySet:number, reason:string}}
 */
export const analyzeCoinJoin = (tx, options = {}) => {
    const config = { ...COINJOIN_DEFAULTS, ...options };
    const inputs = Array.isArray(tx && tx.inputs) ? tx.inputs : null;
    const outputs = Array.isArray(tx && tx.outputs) ? tx.outputs : null;

    if (!inputs || !outputs) {
        return { isCoinJoin: false, confidence: CONFIDENCE.NONE, anonymitySet: 0, reason: 'Transaction has no input/output detail to analyse' };
    }
    if (inputs.length < config.minInputs || outputs.length < config.minOutputs) {
        return {
            isCoinJoin: false,
            confidence: CONFIDENCE.NONE,
            anonymitySet: 0,
            reason: `Too few participants (${inputs.length} in, ${outputs.length} out); a mix needs at least ${config.minInputs}`,
        };
    }

    const group = largestEqualOutputGroup(outputs);
    if (group.count < config.minEqualOutputs) {
        return {
            isCoinJoin: false,
            confidence: CONFIDENCE.NONE,
            anonymitySet: group.count,
            reason: `Outputs are not uniform; largest matching group is ${group.count}`,
        };
    }

    return {
        isCoinJoin: true,
        confidence: gradeCoinJoin(group.count, inputs.length),
        anonymitySet: group.count,
        reason: `${group.count} outputs pay an identical ${group.value} sats across ${inputs.length} inputs`,
    };
};

/** Human readable parts for mainnet, testnet/signet and regtest. */
const SEGWIT_HRPS = new Set(['bc', 'tb', 'bcrt']);

/**
 * Decodes a segwit v0 address and returns its witness program length, or
 * null. The checksum is verified: a shape-only regex accepted any 62
 * characters that looked right, including typos and fabrications.
 */
const v0ProgramLength = (address) => {
    if (typeof address !== 'string') return null;
    try {
        const { hrp, data, constant } = bech32Decode(address);
        if (!SEGWIT_HRPS.has(hrp) || data[0] !== 0 || constant !== BECH32_CONST) return null;
        return convertBits(data.slice(1), 5, 8, false).length;
    } catch {
        return null;
    }
};

export const isP2WSH = (address) => v0ProgramLength(address) === 32;
export const isP2WPKH = (address) => v0ProgramLength(address) === 20;

/**
 * Analyses a transaction for a Lightning channel funding pattern.
 *
 * A channel open pays into a 2-of-2 multisig, which on chain is a P2WSH
 * output. The classic shape is exactly one P2WSH output plus optional change;
 * many P2WSH outputs at once is a batch open or something else entirely.
 *
 * @param {{outputs?:Array}} tx
 * @returns {{isLightning:boolean, confidence:string, reason:string}}
 */
export const analyzeLightningChannel = (tx) => {
    const outputs = Array.isArray(tx && tx.outputs) ? tx.outputs : null;
    if (!outputs) {
        return { isLightning: false, confidence: CONFIDENCE.NONE, reason: 'Transaction has no output detail to analyse' };
    }

    const witnessScriptOutputs = outputs.filter((out) => isP2WSH(out.address));
    if (witnessScriptOutputs.length === 0) {
        return { isLightning: false, confidence: CONFIDENCE.NONE, reason: 'No pay-to-witness-script-hash output' };
    }

    if (witnessScriptOutputs.length === 1 && outputs.length <= 2) {
        return {
            isLightning: true,
            confidence: CONFIDENCE.MEDIUM,
            reason: 'One P2WSH output with at most one change output — the shape of a 2-of-2 channel funding',
        };
    }

    return {
        isLightning: true,
        confidence: CONFIDENCE.LOW,
        reason: `${witnessScriptOutputs.length} P2WSH outputs — a batched channel open, or an unrelated script contract`,
    };
};

/** Boolean form, kept for callers that only need a flag. */
export const detectCoinJoin = (tx, options) => analyzeCoinJoin(tx, options).isCoinJoin;

/** Boolean form, kept for callers that only need a flag. */
export const detectLightningChannel = (tx) => analyzeLightningChannel(tx).isLightning;

/**
 * Runs every heuristic and returns the flags that fired.
 *
 * @param {object} tx
 * @returns {Array<{code:string, confidence:string, reason:string, anonymitySet?:number}>}
 */
export const analyzeTransaction = (tx) => {
    const flags = [];
    const coinjoin = analyzeCoinJoin(tx);
    if (coinjoin.isCoinJoin) {
        flags.push({ code: 'COINJOIN', confidence: coinjoin.confidence, reason: coinjoin.reason, anonymitySet: coinjoin.anonymitySet });
    }

    // A mix already explains a crowd of uniform outputs; do not also call it a channel open.
    if (!coinjoin.isCoinJoin) {
        const lightning = analyzeLightningChannel(tx);
        if (lightning.isLightning) {
            flags.push({ code: 'LIGHTNING_CHANNEL', confidence: lightning.confidence, reason: lightning.reason });
        }
    }

    return flags;
};
