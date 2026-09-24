import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNELS, assertTrustedSender } from '../../main/ipc.js';
import { resolveServablePath, isPermittedRequest, CONTENT_SECURITY_POLICY, createProtocolHandler } from '../../main/protocol.js';
import { encryptionStatus } from '../../main/vault.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** preload.cjs is CommonJS and cannot import ipc.js, so the two lists are compared as text. */
test('preload exposes exactly the channels the main process handles', () => {
    const preload = readFileSync(path.join(ROOT, 'preload.cjs'), 'utf8');
    const declared = [...preload.matchAll(/'(bittax:[a-z:]+)'/g)].map((match) => match[1]).sort();
    assert.deepEqual(declared, Object.values(CHANNELS).sort());
});

test('IPC from anything but the app page is refused', () => {
    const top = (url) => ({ senderFrame: { url, parent: null } });
    assert.doesNotThrow(() => assertTrustedSender(top('app://bittax/renderer/index.html')));
    assert.throws(() => assertTrustedSender(top('https://example.com/')), /untrusted frame/);
    assert.throws(() => assertTrustedSender(top('app://bittax.evil/renderer/index.html')), /untrusted frame/);
    assert.throws(() => assertTrustedSender({ senderFrame: { url: 'app://bittax/x', parent: {} } }), /untrusted frame/);
    assert.throws(() => assertTrustedSender({}), /untrusted frame/);
});

test('app:// serves only the renderer and the audit core', () => {
    assert.equal(resolveServablePath('/renderer/index.html', ROOT), path.join(ROOT, 'renderer', 'index.html'));
    assert.equal(resolveServablePath('/src/core/gains.js', ROOT), path.join(ROOT, 'src', 'core', 'gains.js'));

    for (const escape of [
        '/src/main/vault.js', '/main.js', '/package.json', '/renderer/../main.js',
        '/renderer/%2e%2e/main.js', '/renderer%2F..%2F..%2Fetc%2Fpasswd', '/renderer/%E0%A4%A', '/renderer/a%00.js',
        '/renderer', '/src/core',
    ]) {
        assert.equal(resolveServablePath(escape, ROOT), null, escape);
    }
});

test('the protocol handler refuses other hosts, methods and file types', async () => {
    const handler = createProtocolHandler(ROOT);
    assert.equal((await handler(new Request('app://bittax/renderer/index.html'))).status, 200);
    assert.equal((await handler(new Request('app://other/renderer/index.html'))).status, 403);
    assert.equal((await handler(new Request('app://bittax/renderer/index.html', { method: 'POST', body: 'x' }))).status, 405);
    assert.equal((await handler(new Request('app://bittax/src/core/__tests__/'))).status, 415);
    const ok = await handler(new Request('app://bittax/renderer/app.js'));
    assert.match(ok.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.equal(ok.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('the network allow-list admits nothing remote', () => {
    assert.ok(isPermittedRequest('app://bittax/renderer/app.js'));
    for (const url of ['https://api.coingecko.com/', 'http://localhost:3000', 'file:///etc/passwd', 'ws://x', 'app://bittaxx/']) {
        assert.equal(isPermittedRequest(url), false, url);
    }
    assert.match(CONTENT_SECURITY_POLICY, /connect-src 'none'/);
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-(inline|eval)/);
});

/**
 * On Linux without a keyring, Chromium "encrypts" with a hardcoded key and
 * still reports encryption as available. That must not count.
 */
test('the Linux basic_text backend is treated as no encryption', () => {
    const storage = (backend) => ({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend });
    assert.equal(encryptionStatus(storage('basic_text'), 'linux').available, false);
    assert.equal(encryptionStatus(storage('gnome_libsecret'), 'linux').available, true);
    assert.equal(encryptionStatus(storage('kwallet6'), 'linux').available, true);
    assert.equal(encryptionStatus(storage('basic_text'), 'win32').available, true, 'the backend query is Linux-only');
    assert.equal(encryptionStatus({ isEncryptionAvailable: () => false }, 'darwin').available, false);
});
