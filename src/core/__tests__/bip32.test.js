import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, getHashes } from 'node:crypto';

import { deriveChild, derivePath, deriveAddressRange, HARDENED_OFFSET, CHAIN } from '../bip32.js';
import { parseExtendedPublicKey, deriveAddressesFromXpub } from '../xpub.js';
import { addressFromPublicKey } from '../addresses.js';
import { base58CheckDecode } from '../base58.js';

const hmacSha512 = (key, data) => new Uint8Array(
    createHmac('sha512', Buffer.from(key)).update(Buffer.from(data)).digest(),
);

const hash160 = (bytes) => new Uint8Array(
    createHash('ripemd160').update(createHash('sha256').update(Buffer.from(bytes)).digest()).digest(),
);

const hasRipemd160 = getHashes().includes('ripemd160');
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * BIP32 test vector 1, seed 000102030405060708090a0b0c0d0e0f.
 *
 * Only the public halves are needed: CKDpub walks from m/0H to m/0H/1 using
 * nothing but the parent public key and chain code.
 *
 * If this test fails while `secp256k1.test.js` and `bech32.test.js` pass, check
 * these two strings against BIP32 before suspecting the algorithm.
 */
const VECTOR = {
    // Chain m/0H
    parent: 'xpub68Gmy5EdvgibQVfPdqkBBCHxA5htiqg55crXYuXoQRKfDBFA1WEjWgP6LHhwBZeNK1VTsfTFUHCdrfp1bgwQ9xv5ski8PX9rL2dZXvgGDnw',
    // Chain m/0H/1
    child: 'xpub6ASuArnXKPbfEwhqN6e3mwBcDTgzisQN1wXN9BJcM47sSikHjJf3UFHKkNAWbWMiGj7Wf5uMash7SyYq527Hqck2AxYysAA7xmALppuCkwQ',
};

test('CKDpub reproduces BIP32 test vector 1', () => {
    const parent = parseExtendedPublicKey(VECTOR.parent);
    const expected = parseExtendedPublicKey(VECTOR.child);

    const derived = derivePath(parent, [1], hmacSha512);

    assert.equal(hex(derived.publicKey), expected.publicKey, 'derived public key');
    assert.equal(hex(derived.chainCode), expected.chainCode, 'derived chain code');
    assert.equal(derived.depth, expected.depth, 'depth increments');
});

test('derivation is deterministic', () => {
    const parent = parseExtendedPublicKey(VECTOR.parent);
    const first = derivePath(parent, [0, 5], hmacSha512);
    const second = derivePath(parent, [0, 5], hmacSha512);

    assert.equal(hex(first.publicKey), hex(second.publicKey));
});

test('different indices give different keys', () => {
    const parent = parseExtendedPublicKey(VECTOR.parent);
    const a = derivePath(parent, [0, 0], hmacSha512);
    const b = derivePath(parent, [0, 1], hmacSha512);

    assert.notEqual(hex(a.publicKey), hex(b.publicKey));
});

/** Hardened derivation needs the parent private key, which a watch-only tool never has. */
test('hardened indices are refused', () => {
    const parent = parseExtendedPublicKey(VECTOR.parent);
    const node = {
        publicKey: Uint8Array.from(parent.publicKey.match(/../g).map((b) => Number.parseInt(b, 16))),
        chainCode: Uint8Array.from(parent.chainCode.match(/../g).map((b) => Number.parseInt(b, 16))),
        depth: parent.depth,
    };

    assert.throws(() => deriveChild(node, HARDENED_OFFSET, hmacSha512), /hardened/);
    assert.throws(() => deriveChild(node, HARDENED_OFFSET + 7, hmacSha512), /hardened/);
    assert.throws(() => deriveChild(node, -1, hmacSha512), /non-negative integer/);
});

test('a bad HMAC implementation is caught rather than trusted', () => {
    const parent = parseExtendedPublicKey(VECTOR.parent);
    const node = {
        publicKey: Uint8Array.from(parent.publicKey.match(/../g).map((b) => Number.parseInt(b, 16))),
        chainCode: Uint8Array.from(parent.chainCode.match(/../g).map((b) => Number.parseInt(b, 16))),
        depth: parent.depth,
    };

    assert.throws(() => deriveChild(node, 0, () => new Uint8Array(32)), /64 bytes/);
    assert.throws(() => deriveChild(node, 0, undefined), /HMAC-SHA512 implementation/);
});

test('a range of addresses is derived on the requested chain', { skip: !hasRipemd160 }, () => {
    const parsed = parseExtendedPublicKey(VECTOR.parent);
    const toAddress = (publicKey) => addressFromPublicKey(publicKey, {
        script: parsed.script,
        network: parsed.network,
        hash160,
    });

    const external = deriveAddressRange(parsed, { chain: CHAIN.EXTERNAL, count: 3, hmacSha512, toAddress });
    const internal = deriveAddressRange(parsed, { chain: CHAIN.INTERNAL, count: 3, hmacSha512, toAddress });

    assert.equal(external.length, 3);
    assert.deepEqual(external.map((entry) => entry.index), [0, 1, 2]);
    assert.deepEqual(external.map((entry) => entry.path), ['m/0/0', 'm/0/1', 'm/0/2']);

    // The receive and change chains must never collide.
    const overlap = external.filter((entry) => internal.some((other) => other.address === entry.address));
    assert.deepEqual(overlap, []);

    // Every address in a run is distinct.
    assert.equal(new Set(external.map((entry) => entry.address)).size, 3);
});

test('start and count select a window', { skip: !hasRipemd160 }, () => {
    const parsed = parseExtendedPublicKey(VECTOR.parent);
    const toAddress = (publicKey) => addressFromPublicKey(publicKey, {
        script: parsed.script, network: parsed.network, hash160,
    });

    const all = deriveAddressRange(parsed, { count: 5, hmacSha512, toAddress });
    const window = deriveAddressRange(parsed, { start: 2, count: 2, hmacSha512, toAddress });

    assert.deepEqual(window.map((entry) => entry.address), all.slice(2, 4).map((entry) => entry.address));
});

test('an xpub produces legacy addresses that start with 1', { skip: !hasRipemd160 }, () => {
    const addresses = deriveAddressesFromXpub(VECTOR.parent, { hmacSha512, hash160, count: 4 });

    assert.equal(addresses.length, 4);
    for (const { address, publicKey } of addresses) {
        assert.match(address, /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/, address);

        // The payload is a version byte plus a 20 byte hash.
        const decoded = base58CheckDecode(address);
        assert.equal(decoded.length, 21);
        assert.equal(decoded[0], 0x00, 'mainnet P2PKH version byte');

        assert.equal(publicKey.length, 66);
        assert.ok(publicKey.startsWith('02') || publicKey.startsWith('03'));
    }
});

test('script type decides the address format', { skip: !hasRipemd160 }, () => {
    const parsed = parseExtendedPublicKey(VECTOR.parent);
    const node = derivePath(parsed, [0, 0], hmacSha512);

    const legacy = addressFromPublicKey(node.publicKey, { script: 'P2PKH', network: 'mainnet', hash160 });
    const nested = addressFromPublicKey(node.publicKey, { script: 'P2SH-P2WPKH', network: 'mainnet', hash160 });
    const native = addressFromPublicKey(node.publicKey, { script: 'P2WPKH', network: 'mainnet', hash160 });

    assert.match(legacy, /^1/);
    assert.match(nested, /^3/, 'P2SH addresses start with 3');
    assert.match(native, /^bc1q/);
    assert.equal(native.length, 42);

    assert.equal(base58CheckDecode(nested)[0], 0x05, 'mainnet P2SH version byte');

    // The three encodings of one key must all differ.
    assert.equal(new Set([legacy, nested, native]).size, 3);
});

test('testnet keys produce testnet addresses', { skip: !hasRipemd160 }, () => {
    const publicKey = derivePath(parseExtendedPublicKey(VECTOR.parent), [0, 0], hmacSha512).publicKey;

    assert.match(addressFromPublicKey(publicKey, { script: 'P2WPKH', network: 'testnet', hash160 }), /^tb1q/);
    assert.equal(
        base58CheckDecode(addressFromPublicKey(publicKey, { script: 'P2PKH', network: 'testnet', hash160 }))[0],
        0x6f,
    );
});

test('address encoding validates its inputs', () => {
    assert.throws(
        () => addressFromPublicKey(new Uint8Array(32), { script: 'P2PKH', network: 'mainnet', hash160: () => new Uint8Array(20) }),
        /33-byte compressed public key/,
    );
    assert.throws(
        () => addressFromPublicKey(new Uint8Array(33), { script: 'P2PKH', network: 'mars', hash160: () => new Uint8Array(20) }),
        /Unknown network/,
    );
    assert.throws(
        () => addressFromPublicKey(new Uint8Array(33), { script: 'P2TR', network: 'mainnet', hash160: () => new Uint8Array(20) }),
        /Cannot derive a single-signature address/,
    );
    assert.throws(
        () => addressFromPublicKey(new Uint8Array(33), { script: 'P2PKH', network: 'mainnet', hash160: () => new Uint8Array(19) }),
        /must return 20 bytes/,
    );
});
