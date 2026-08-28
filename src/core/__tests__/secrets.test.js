import test from 'node:test';
import assert from 'node:assert/strict';

import { detectSecretMaterial, assertNoSecretMaterial, SECRET_KIND } from '../secrets.js';

const kindOf = (input) => {
    const found = detectSecretMaterial(input);
    return found ? found.kind : null;
};

test('catches extended private keys across every SLIP-132 prefix', () => {
    for (const prefix of ['xprv', 'yprv', 'zprv', 'tprv', 'uprv', 'vprv', 'Yprv', 'Zprv']) {
        assert.equal(kindOf(`${prefix}9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi`), SECRET_KIND.EXTENDED_PRIVATE_KEY, prefix);
    }
});

test('catches WIF private keys', () => {
    assert.equal(kindOf('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'), SECRET_KIND.WIF_PRIVATE_KEY);
    assert.equal(kindOf('L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1'), SECRET_KIND.WIF_PRIVATE_KEY);
    assert.equal(kindOf('KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'), SECRET_KIND.WIF_PRIVATE_KEY);
});

test('catches raw 256-bit keys with or without a hex prefix', () => {
    const key = 'e9873d79c6d87dc0fb6a5778633389f4453213303da61f20bd67fc233aa33262';
    assert.equal(kindOf(key), SECRET_KIND.RAW_PRIVATE_KEY);
    assert.equal(kindOf(`0x${key}`), SECRET_KIND.RAW_PRIVATE_KEY);
    assert.equal(kindOf(key.toUpperCase()), SECRET_KIND.RAW_PRIVATE_KEY);
});

test('catches seed phrases at every valid BIP39 length', () => {
    const word = 'abandon';
    for (const length of [12, 15, 18, 21, 24]) {
        const phrase = Array.from({ length }, () => word).join(' ');
        assert.equal(kindOf(phrase), SECRET_KIND.MNEMONIC, `${length} words`);
    }
});

test('does not fire on watch-only material or ordinary text', () => {
    assert.equal(kindOf('xpub6CUGRUonZSQ4cisLCpxXVHhAF'), null);
    assert.equal(kindOf('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), null);
    assert.equal(kindOf('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), null);
    assert.equal(kindOf(''), null);
    assert.equal(kindOf(null), null);
    assert.equal(kindOf(undefined), null);
    // Thirteen words is not a valid mnemonic length.
    assert.equal(kindOf(Array.from({ length: 13 }, () => 'abandon').join(' ')), null);
});

test('the warning tells the user what to do about it', () => {
    const found = detectSecretMaterial('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ');
    assert.match(found.message, /never needs a private key/);
    assert.match(found.message, /move the funds/);
});

test('assertNoSecretMaterial throws a tagged error', () => {
    assert.throws(
        () => assertNoSecretMaterial('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'),
        (error) => error.name === 'SecretMaterialError' && error.kind === SECRET_KIND.EXTENDED_PRIVATE_KEY,
    );
    assert.doesNotThrow(() => assertNoSecretMaterial('xpub661MyMwAqRbcF'));
});
