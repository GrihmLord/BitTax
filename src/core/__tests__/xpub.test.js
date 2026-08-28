import test from 'node:test';
import assert from 'node:assert/strict';

import { base58CheckEncode } from '../base58.js';
import { parseExtendedPublicKey, isValidExtendedPublicKey, maskExtendedKey, deriveAddressesFromXpub } from '../xpub.js';

/**
 * Builds a serialised extended key so the parser can be exercised against
 * every field independently. Encoding with our own Base58Check writer is
 * deliberate: the alphabet itself is proved separately in base58.test.js
 * against a real address, so this file can focus purely on the BIP32 layout.
 */
const buildKey = ({
    version = 0x0488b21e,
    depth = 3,
    parentFingerprint = 0x12345678,
    childNumber = 0x80000000,
    chainCodeByte = 0xab,
    keyPrefix = 0x02,
} = {}) => {
    const payload = new Uint8Array(78);
    const view = new DataView(payload.buffer);

    view.setUint32(0, version, false);
    payload[4] = depth;
    view.setUint32(5, parentFingerprint, false);
    view.setUint32(9, childNumber, false);
    payload.fill(chainCodeByte, 13, 45);
    payload[45] = keyPrefix;
    payload.fill(0x11, 46, 78);

    return base58CheckEncode(payload);
};

test('parses a well-formed key and reports its script type', () => {
    const parsed = parseExtendedPublicKey(buildKey());

    assert.equal(parsed.prefix, 'xpub');
    assert.equal(parsed.network, 'mainnet');
    assert.equal(parsed.script, 'P2PKH');
    assert.equal(parsed.purpose, 44);
    assert.equal(parsed.depth, 3);
    assert.equal(parsed.parentFingerprint, '12345678');
    assert.equal(parsed.chainCode.length, 64);
    assert.equal(parsed.publicKey.length, 66);
    assert.ok(parsed.publicKey.startsWith('02'));
});

test('recognises the SLIP-132 script variants', () => {
    assert.equal(parseExtendedPublicKey(buildKey({ version: 0x049d7cb2 })).prefix, 'ypub');
    assert.equal(parseExtendedPublicKey(buildKey({ version: 0x04b24746 })).prefix, 'zpub');
    assert.equal(parseExtendedPublicKey(buildKey({ version: 0x043587cf })).network, 'testnet');
});

test('the old prefix check accepted strings this parser rejects', () => {
    // Every one of these starts with "xpub" and would have passed the previous
    // `startsWith('xpub')` validation.
    assert.equal(isValidExtendedPublicKey('xpub'), false);
    assert.equal(isValidExtendedPublicKey('xpubTotallyMadeUp'), false);
    assert.equal(isValidExtendedPublicKey('xpub6CUGRUonZSQ4cisLCpxXVHhAF... (DEMO)'), false);
    assert.equal(isValidExtendedPublicKey(''), false);
    assert.equal(isValidExtendedPublicKey(null), false);
});

test('rejects a key whose checksum does not hold', () => {
    const key = buildKey();
    const tampered = `${key.slice(0, -1)}${key.at(-1) === 'a' ? 'b' : 'a'}`;
    assert.throws(() => parseExtendedPublicKey(tampered), { name: 'InvalidExtendedKeyError' });
});

test('rejects unknown version bytes', () => {
    assert.throws(() => parseExtendedPublicKey(buildKey({ version: 0xdeadbeef })), /Unrecognised version bytes/);
});

test('refuses private key material wearing a public prefix', () => {
    assert.throws(
        () => parseExtendedPublicKey(buildKey({ keyPrefix: 0x00 })),
        { name: 'SecretMaterialError' },
    );
});

test('rejects a malformed public key point prefix', () => {
    assert.throws(() => parseExtendedPublicKey(buildKey({ keyPrefix: 0x07 })), /compressed point prefix/);
});

test('enforces the BIP32 rule that a master key has no parent', () => {
    assert.throws(
        () => parseExtendedPublicKey(buildKey({ depth: 0, parentFingerprint: 0x11111111, childNumber: 0 })),
        /parent fingerprint/,
    );
    assert.throws(
        () => parseExtendedPublicKey(buildKey({ depth: 0, parentFingerprint: 0, childNumber: 5 })),
        /child index/,
    );
    assert.ok(parseExtendedPublicKey(buildKey({ depth: 0, parentFingerprint: 0, childNumber: 0 })));
});

test('tolerates surrounding whitespace', () => {
    const key = buildKey();
    assert.equal(parseExtendedPublicKey(`  ${key}\n`).normalised, key);
});

test('masking never reveals enough to reconstruct the key', () => {
    const key = buildKey();
    const masked = maskExtendedKey(key);

    assert.ok(masked.length < key.length);
    assert.ok(masked.includes('…'));
    assert.equal(maskExtendedKey('short'), '•••••');
});

/**
 * The original implementation returned two hardcoded placeholder addresses,
 * indistinguishable from real output. Without the injected hash functions it
 * must refuse rather than produce anything.
 */
test('address derivation refuses without its crypto dependencies', () => {
    assert.throws(() => deriveAddressesFromXpub(buildKey()), { name: 'MissingCryptoDependencyError' });
    assert.throws(
        () => deriveAddressesFromXpub(buildKey(), { hmacSha512: () => new Uint8Array(64) }),
        { name: 'MissingCryptoDependencyError' },
    );
});

test('multisig keys are refused, because an address needs every cosigner', () => {
    assert.throws(
        () => deriveAddressesFromXpub(buildKey({ version: 0x02aa7ed3 }), {
            hmacSha512: () => new Uint8Array(64),
            hash160: () => new Uint8Array(20),
        }),
        { name: 'UnsupportedScriptError' },
    );
});
