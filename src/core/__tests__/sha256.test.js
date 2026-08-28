import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { sha256, sha256d, bytesToHex, utf8ToBytes } from '../sha256.js';

const hex = (text) => bytesToHex(sha256(utf8ToBytes(text)));

test('matches the published FIPS 180-4 vectors', () => {
    assert.equal(hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(
        hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
});

/**
 * Cross-checks against Node's own SHA-256 across every length that exercises a
 * different padding path: inside one block, exactly at the 55/56 byte boundary
 * where the length field forces a second block, and across several blocks.
 */
test('agrees with node:crypto across padding boundaries', () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + 7) & 0xff;

        const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
        assert.equal(bytesToHex(sha256(bytes)), expected, `length ${length}`);
    }
});

test('sha256d is SHA-256 applied twice', () => {
    const bytes = utf8ToBytes('bittax');
    const expected = createHash('sha256')
        .update(createHash('sha256').update(Buffer.from(bytes)).digest())
        .digest('hex');
    assert.equal(bytesToHex(sha256d(bytes)), expected);
});

test('utf8ToBytes encodes beyond the basic plane', () => {
    assert.deepEqual(Array.from(utf8ToBytes('A')), [0x41]);
    assert.deepEqual(Array.from(utf8ToBytes('£')), [0xc2, 0xa3]);
    assert.deepEqual(Array.from(utf8ToBytes('€')), [0xe2, 0x82, 0xac]);
    // A surrogate pair must encode as one 4-byte sequence, not two 3-byte ones.
    assert.deepEqual(Array.from(utf8ToBytes('𝄞')), [0xf0, 0x9d, 0x84, 0x9e]);
    assert.equal(
        bytesToHex(sha256(utf8ToBytes('€'))),
        createHash('sha256').update('€', 'utf8').digest('hex'),
    );
});

test('rejects anything that is not a byte array', () => {
    assert.throws(() => sha256('abc'), /Uint8Array/);
});
