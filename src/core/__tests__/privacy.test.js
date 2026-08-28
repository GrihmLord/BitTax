import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyzeCoinJoin, analyzeLightningChannel, analyzeTransaction,
    detectCoinJoin, detectLightningChannel, isP2WSH, isP2WPKH, CONFIDENCE,
} from '../privacy.js';

const P2WSH_ADDRESS = 'bc1qrp33g0q5c5txsp9dysjy386pxqry4y6k9k0q5k2k0q5k2k0q5k2k0q5k2k';

test('a plain two-party transaction is not flagged', () => {
    const tx = { inputs: [{}, {}], outputs: [{ value: '0.5' }, { value: '0.1' }] };
    assert.equal(detectCoinJoin(tx), false);
    assert.equal(detectLightningChannel(tx), false);
});

test('detects a uniform-output mix', () => {
    const result = analyzeCoinJoin({
        inputs: [{}, {}, {}, {}, {}],
        outputs: [{ value: '0.1' }, { value: '0.1' }, { value: '0.1' }, { value: '0.1' }, { value: '0.0432' }],
    });

    assert.equal(result.isCoinJoin, true);
    assert.equal(result.anonymitySet, 4);
    assert.match(result.reason, /identical/);
});

/**
 * Outputs were previously grouped by their floating point value, so amounts
 * that are equal on chain could land in different buckets. Grouping is now
 * done on integer satoshis.
 */
test('groups outputs by exact satoshi value, not by float', () => {
    const outputs = Array.from({ length: 6 }, () => ({ value: 0.1 }));
    const result = analyzeCoinJoin({ inputs: [{}, {}, {}, {}, {}, {}], outputs });

    assert.equal(result.anonymitySet, 6);
    assert.equal(result.confidence, CONFIDENCE.HIGH);
});

test('accepts pre-converted integer satoshi values', () => {
    const outputs = Array.from({ length: 5 }, () => ({ valueSats: 10000000n }));
    assert.equal(analyzeCoinJoin({ inputs: [{}, {}, {}, {}, {}], outputs }).isCoinJoin, true);
});

test('a crowd with no uniform amount is not a mix', () => {
    const result = analyzeCoinJoin({
        inputs: [{}, {}, {}, {}, {}],
        outputs: [{ value: '0.1' }, { value: '0.2' }, { value: '0.3' }, { value: '0.4' }, { value: '0.5' }],
    });

    assert.equal(result.isCoinJoin, false);
    assert.match(result.reason, /not uniform/);
});

test('missing input or output detail is reported, not guessed at', () => {
    assert.equal(analyzeCoinJoin({}).isCoinJoin, false);
    assert.match(analyzeCoinJoin({}).reason, /no input\/output detail/);
    assert.equal(analyzeCoinJoin(null).isCoinJoin, false);
});

test('identifies segwit script types by their real bech32 shape', () => {
    assert.equal(isP2WSH(P2WSH_ADDRESS), true);
    assert.equal(isP2WSH('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), false, 'that is a P2WPKH');
    assert.equal(isP2WPKH('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), true);
    assert.equal(isP2WSH('bc1q_not_bech32_at_all'), false);
    assert.equal(isP2WSH(undefined), false);
});

test('recognises testnet as well as mainnet', () => {
    assert.equal(isP2WSH(P2WSH_ADDRESS.replace(/^bc/, 'tb')), true);
});

test('a lone P2WSH output beside change reads as a channel funding', () => {
    const result = analyzeLightningChannel({
        outputs: [{ address: P2WSH_ADDRESS, value: '0.5' }, { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', value: '0.49' }],
    });

    assert.equal(result.isLightning, true);
    assert.equal(result.confidence, CONFIDENCE.MEDIUM);
});

test('many script outputs at once are reported with lower confidence', () => {
    const outputs = Array.from({ length: 4 }, () => ({ address: P2WSH_ADDRESS }));
    const result = analyzeLightningChannel({ outputs });

    assert.equal(result.isLightning, true);
    assert.equal(result.confidence, CONFIDENCE.LOW);
});

test('a mix is not also reported as a channel open', () => {
    const flags = analyzeTransaction({
        inputs: [{}, {}, {}, {}, {}],
        outputs: [
            { value: '0.1', address: P2WSH_ADDRESS },
            { value: '0.1', address: P2WSH_ADDRESS },
            { value: '0.1', address: P2WSH_ADDRESS },
            { value: '0.1', address: P2WSH_ADDRESS },
            { value: '0.05', address: P2WSH_ADDRESS },
        ],
    });

    assert.deepEqual(flags.map((flag) => flag.code), ['COINJOIN']);
});

test('every flag carries a reason a preparer can act on', () => {
    const flags = analyzeTransaction({
        inputs: [{ value: '1.0' }],
        outputs: [{ address: P2WSH_ADDRESS, value: '0.5' }],
    });

    assert.equal(flags.length, 1);
    assert.equal(flags[0].code, 'LIGHTNING_CHANNEL');
    assert.ok(flags[0].reason.length > 0);
    assert.ok(flags[0].confidence);
});
