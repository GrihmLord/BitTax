import test from 'node:test';
import assert from 'node:assert/strict';
import { getHashes } from 'node:crypto';

import { runSelfTest, ensureReady, deriveAddresses, MAX_ADDRESSES, BIP32_VECTOR } from '../../main/derive.js';

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

/**
 * Output pinned from the affine implementation before the Jacobian rewrite,
 * which is itself gated by BIP32 test vector 1. Any change to the curve code
 * that alters an address fails here.
 */
test('scalar multiplication rewrite reproduces the pinned addresses', { skip: !hasRipemd160 }, () => {
    const { addresses } = deriveAddresses(BIP32_VECTOR.parent, { count: 200 });
    assert.equal(addresses[0].address, '1BvgsfsZQVtkLS69NvGF8rw6NZW2ShJQHr');
    assert.equal(addresses[199].address, '14wHdZBeckfyrSV7QTxiZLjctGYnHH8xgW');
});

/** BIP84 test vector: "abandon abandon ... about", account m/84'/0'/0'. */
test('a zpub derives the BIP84 reference addresses', { skip: !hasRipemd160 }, () => {
    const zpub = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    const receive = deriveAddresses(zpub, { chain: 0, count: 2 });
    assert.equal(receive.addresses[0].address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    assert.equal(receive.addresses[1].address, 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
    const change = deriveAddresses(zpub, { chain: 1, count: 1 });
    assert.equal(change.addresses[0].address, 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
});

test('200 addresses derive quickly enough to stay on the main process', { skip: !hasRipemd160 }, () => {
    const began = performance.now();
    deriveAddresses(BIP32_VECTOR.parent, { chain: 1, count: 200 });
    const elapsed = performance.now() - began;
    assert.ok(elapsed < 3000, `took ${Math.round(elapsed)}ms`);
});
