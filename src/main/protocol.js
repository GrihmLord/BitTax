/**
 * protocol.js  (main process only)
 * The `app://` scheme: what it serves, and the headers it serves it with.
 *
 * Kept free of any `electron` import so the path-containment rules can be
 * proven by the Node test runner without launching Electron.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

export const APP_SCHEME = 'app';
export const APP_HOST = 'bittax';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const ENTRY_URL = `${APP_ORIGIN}/renderer/index.html`;

export const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    `script-src ${APP_ORIGIN}`,
    `style-src ${APP_ORIGIN}`,
    `img-src ${APP_ORIGIN} data:`,
    `font-src ${APP_ORIGIN}`,
    "connect-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "media-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
].join('; ');

const MIME_TYPES = Object.freeze({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
});

export const SECURITY_HEADERS = Object.freeze({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), clipboard-read=()',
    'Cache-Control': 'no-store',
});

/**
 * Only these subtrees are reachable over `app://`. Everything else — the repo
 * root, node_modules, src/main, the user's home directory — is unreachable
 * even if a path traversal makes it past normalisation.
 *
 * @param {string} projectRoot
 */
export const servableRoots = (projectRoot) => ['renderer', path.join('src', 'core')].map((dir) => path.join(projectRoot, dir));

/**
 * Resolves a request path to a file inside one of the servable roots.
 * Returns null for anything outside them, or for a path that does not decode.
 *
 * @param {string} requestPath - the URL pathname
 * @param {string} projectRoot
 */
export const resolveServablePath = (requestPath, projectRoot) => {
    let decoded;
    try {
        decoded = decodeURIComponent(requestPath);
    } catch {
        return null;
    }
    if (decoded.includes('\0')) return null;

    const candidate = path.resolve(projectRoot, decoded.replace(/^[/\\]+/, ''));
    const permitted = servableRoots(projectRoot).some((root) => candidate.startsWith(root + path.sep));
    return permitted ? candidate : null;
};

const respond = (body, status, contentType) =>
    new Response(body, { status, headers: { ...SECURITY_HEADERS, 'Content-Type': contentType } });

/**
 * Builds the `app://` request handler for a project root.
 *
 * @param {string} projectRoot
 * @returns {(request: Request) => Promise<Response>}
 */
export const createProtocolHandler = (projectRoot) => async (request) => {
    if (request.method !== 'GET') return respond('Method not allowed', 405, 'text/plain; charset=utf-8');

    const url = new URL(request.url);
    if (url.host !== APP_HOST) return respond('Forbidden', 403, 'text/plain; charset=utf-8');

    const filePath = resolveServablePath(url.pathname, projectRoot);
    if (!filePath) return respond('Forbidden', 403, 'text/plain; charset=utf-8');

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()];
    if (!contentType) return respond('Unsupported media type', 415, 'text/plain; charset=utf-8');

    try {
        return respond(await fs.readFile(filePath), 200, contentType);
    } catch {
        return respond('Not found', 404, 'text/plain; charset=utf-8');
    }
};

/** True for URLs the renderer may load: its own scheme, plus inline data it creates. */
export const isPermittedRequest = (url) => url.startsWith(`${APP_ORIGIN}/`)
    || url.startsWith('devtools://')
    || url.startsWith('blob:app://')
    || url.startsWith('data:');
