import test from 'node:test';
import assert from 'node:assert/strict';
import { getHashes } from 'node:crypto';

import { runSelfTest, ensureReady, deriveAddresses, MAX_ADDRESSES, BIP32_VECTOR } from '../../main/derive.mjs';

const hasRipemd160 = getHashes().includes('ripemd160');

/**
 * The gate that stands between a broken build and wrong addresses. If this
 * fails, `deriveAddresses` must refuse — the failure list names which check
 * went wrong so the cause is obvious rather than mysterious.
 */
test('the derivation self test passes', { skip: !hasRipemd160 }, () => {
    const report = runSelfTest();
    assert.deepEqual(report.failures, [], 'no check should fail');
    assert.equal(report.ok, true);
});

test('the self test result is cached, not recomputed', { skip: !hasRipemd160 }, () => {
    assert.equal(runSelfTest(), runSelfTest());
});

test('ensureReady does not throw on a healthy build', { skip: !hasRipemd160 }, () => {
    assert.doesNotThrow(() => ensureReady());
});

test('derives addresses from the BIP32 vector key', { skip: !hasRipemd160 }, () => {
    const result = deriveAddresses(BIP32_VECTOR.parent, { count: 5 });

    assert.equal(result.addresses.length, 5);
    assert.equal(result.chain, 0);
    assert.equal(result.key.script, 'P2PKH');
    assert.equal(result.key.network, 'mainnet');

    for (const entry of result.addresses) {
        assert.match(entry.address, /^1/);
        assert.equal(entry.publicKey.length, 66);
    }

    // Index 1 of the external chain is m/0/1 relative to this key.
    assert.equal(result.addresses[1].path, 'm/0/1');
});

test('the change chain differs from the receive chain', { skip: !hasRipemd160 }, () => {
    const receive = deriveAddresses(BIP32_VECTOR.parent, { chain: 0, count: 3 });
    const change = deriveAddresses(BIP32_VECTOR.parent, { chain: 1, count: 3 });

    assert.notDeepEqual(
        receive.addresses.map((entry) => entry.address),
        change.addresses.map((entry) => entry.address),
    );
    assert.equal(change.chain, 1);
});

test('a scan is capped so a bad count cannot hang the app', { skip: !hasRipemd160 }, () => {
    const result = deriveAddresses(BIP32_VECTOR.parent, { count: 10000 });
    assert.equal(result.addresses.length, MAX_ADDRESSES);
});

test('private material is refused before anything else happens', () => {
    assert.throws(
        () => deriveAddresses('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'),
        { name: 'SecretMaterialError' },
    );
});

test('an invalid key is refused', () => {
    assert.throws(() => deriveAddresses('xpubNotARealKey'), { name: 'InvalidExtendedKeyError' });
    assert.throws(() => deriveAddresses(''), { name: 'InvalidExtendedKeyError' });
});
