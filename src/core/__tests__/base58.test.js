import test from 'node:test';
import assert from 'node:assert/strict';

import { base58Decode, base58Encode, base58CheckDecode, base58CheckEncode } from '../base58.js';

/**
 * The Bitcoin genesis coinbase address. Using a real, universally known
 * Base58Check string is what actually proves the alphabet is right: a single
 * wrong character in the table would make this fail its checksum.
 */
const GENESIS_ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

test('decodes a real Base58Check address and re-encodes it unchanged', () => {
    const payload = base58CheckDecode(GENESIS_ADDRESS);

    // Version byte plus a 20 byte HASH160.
    assert.equal(payload.length, 21);
    assert.equal(payload[0], 0x00, 'mainnet P2PKH version byte');
    assert.equal(base58CheckEncode(payload), GENESIS_ADDRESS);
});

test('a single altered character fails the checksum', () => {
    const tampered = `${GENESIS_ADDRESS.slice(0, -1)}b`;
    assert.throws(() => base58CheckDecode(tampered), /Checksum mismatch/);
});

test('leading zero bytes map to leading ones', () => {
    assert.equal(base58Encode(new Uint8Array([0, 0, 0])), '111');
    assert.equal(base58Encode(new Uint8Array([0, 0, 1])), '112');
    assert.deepEqual(Array.from(base58Decode('112')), [0, 0, 1]);
});

test('round-trips arbitrary byte strings', () => {
    for (let length = 0; length <= 40; length += 1) {
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) bytes[i] = (i * 17 + 3) & 0xff;
        if (length === 0) continue;

        assert.deepEqual(Array.from(base58CheckDecode(base58CheckEncode(bytes))), Array.from(bytes), `length ${length}`);
    }
});

test('rejects characters outside the alphabet, with a hint for confusables', () => {
    assert.throws(() => base58Decode('0OIl'), /Invalid Base58 character/);
    assert.throws(() => base58Decode('1O1'), /did you mean "0"/);
    assert.throws(() => base58Decode('1I1'), /did you mean "1"/);
    assert.throws(() => base58Decode(''), /empty/);
});

test('rejects a payload too short to carry a checksum', () => {
    assert.throws(() => base58CheckDecode('11'), /too short/);
});
