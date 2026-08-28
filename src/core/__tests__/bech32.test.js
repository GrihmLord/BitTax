import test from 'node:test';
import assert from 'node:assert/strict';

import {
    bech32Encode, bech32Decode, encodeSegwitAddress, convertBits, selfTest,
    BECH32_CONST, BECH32M_CONST,
} from '../bech32.js';

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));

/** BIP173's canonical P2WPKH example. */
const P2WPKH_PROGRAM = hexToBytes('751e76e8199196d454941c45d1b3a323f1433bd6');
const P2WPKH_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

test('the built-in self test passes', () => {
    const report = selfTest();
    assert.deepEqual(report.failures, []);
    assert.equal(report.ok, true);
});

test('encodes the BIP173 P2WPKH vector', () => {
    assert.equal(encodeSegwitAddress('bc', 0, P2WPKH_PROGRAM), P2WPKH_ADDRESS);
});

test('testnet uses the tb prefix', () => {
    const address = encodeSegwitAddress('tb', 0, P2WPKH_PROGRAM);
    assert.ok(address.startsWith('tb1q'));
    assert.equal(address.length, P2WPKH_ADDRESS.length);
});

test('a 32-byte program encodes as P2WSH', () => {
    const address = encodeSegwitAddress('bc', 0, new Uint8Array(32).fill(0xab));
    assert.ok(address.startsWith('bc1q'));
    // 20-byte programs give 42 characters; 32-byte programs give 62.
    assert.equal(address.length, 62);
});

/** Version 0 uses bech32; version 1 and above use bech32m. Mixing them is an invalid address. */
test('witness version selects the checksum constant', () => {
    const v0 = bech32Decode(encodeSegwitAddress('bc', 0, P2WPKH_PROGRAM));
    assert.equal(v0.constant, BECH32_CONST);

    const v1 = bech32Decode(encodeSegwitAddress('bc', 1, new Uint8Array(32).fill(0x11)));
    assert.equal(v1.constant, BECH32M_CONST);
});

test('encoding round-trips through the decoder', () => {
    const { hrp, data } = bech32Decode(P2WPKH_ADDRESS);
    assert.equal(hrp, 'bc');
    assert.equal(data[0], 0, 'witness version 0');

    const recovered = Uint8Array.from(convertBits(data.slice(1), 5, 8, false));
    assert.deepEqual(Array.from(recovered), Array.from(P2WPKH_PROGRAM));
});

test('a single altered character breaks the checksum', () => {
    const tampered = `${P2WPKH_ADDRESS.slice(0, -1)}${P2WPKH_ADDRESS.at(-1) === '4' ? '5' : '4'}`;
    assert.throws(() => bech32Decode(tampered), /checksum does not verify/);
});

test('rejects malformed strings', () => {
    assert.throws(() => bech32Decode('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4A'), /mix cases/);
    assert.throws(() => bech32Decode('nodelimiter'), /Malformed/);
    // Too short to carry a 6 character checksum after the separator.
    assert.throws(() => bech32Decode('bc1'), /Malformed/);
    assert.throws(() => bech32Decode('bc1qbio'), /Malformed/);

    // 'b' is one of the four characters bech32 excludes, so a full-length string
    // containing it gets past the length guard and fails on the character.
    const withExcludedChar = P2WPKH_ADDRESS.replace('bc1q', 'bc1b');
    assert.throws(() => bech32Decode(withExcludedChar), /Invalid bech32 character "b"/);
});

test('rejects invalid witness programs', () => {
    assert.throws(() => encodeSegwitAddress('bc', -1, P2WPKH_PROGRAM), /Witness version/);
    assert.throws(() => encodeSegwitAddress('bc', 17, P2WPKH_PROGRAM), /Witness version/);
    assert.throws(() => encodeSegwitAddress('bc', 0, new Uint8Array(1)), /2 to 40 bytes/);
    assert.throws(() => encodeSegwitAddress('bc', 0, new Uint8Array(41)), /2 to 40 bytes/);
    // Version 0 is only defined for 20 and 32 byte programs.
    assert.throws(() => encodeSegwitAddress('bc', 0, new Uint8Array(21)), /20 bytes .* or 32 bytes/);
});

test('bit conversion packs and unpacks losslessly', () => {
    const bytes = [0xff, 0x00, 0xaa, 0x55, 0x12];
    const five = convertBits(bytes, 8, 5, true);
    assert.ok(five.every((value) => value >= 0 && value < 32));
    assert.deepEqual(convertBits(five, 5, 8, false), bytes);
});

test('bit conversion rejects out-of-range input', () => {
    assert.throws(() => convertBits([256], 8, 5, true), /does not fit in 8 bits/);
    assert.throws(() => convertBits([-1], 8, 5, true), /does not fit in 8 bits/);
});

test('the 90 character limit is enforced', () => {
    assert.throws(() => bech32Encode('bc', new Array(100).fill(0)), /90 characters/);
    assert.throws(() => bech32Encode('', [0]), /human readable part/);
});
