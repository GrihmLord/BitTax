/**
 * main.js
 * Electron main process.
 *
 * Security posture, in order of importance:
 *   1. The renderer has no Node. contextIsolation on, sandbox on,
 *      nodeIntegration off. Every privileged action goes through a named,
 *      validated IPC channel declared in preload.js.
 *   2. Content is served over a custom `app://` scheme so a strict
 *      Content-Security-Policy can be attached to real response headers,
 *      which a `file://` page cannot have.
 *   3. The network is switched off at the session level. This tool audits
 *      cold storage; nothing it holds should ever leave the machine, and an
 *      offline guarantee is worth more than a promise in a README.
 *   4. Navigation, new windows, permissions and webviews are all denied.
 */

const { app, BrowserWindow, Menu, protocol, session, dialog, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

/**
 * Development mode is opted into by an explicit flag rather than an
 * environment variable, so `npm run electron:dev` behaves the same on every
 * platform without pulling in a cross-platform env shim.
 */
const IS_DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const APP_SCHEME = 'app';
const APP_HOST = 'bittax';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const ENTRY_URL = `${APP_ORIGIN}/renderer/index.html`;

const PROJECT_ROOT = __dirname;

/**
 * Only these subtrees are reachable over `app://`. Everything else — the repo
 * root, node_modules, the user's home directory — is unreachable even if a
 * path traversal makes it past normalisation.
 */
const SERVABLE_ROOTS = ['renderer', path.join('src', 'core')].map((dir) => path.join(PROJECT_ROOT, dir));

const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    `script-src ${APP_ORIGIN}`,
    `style-src ${APP_ORIGIN}`,
    `img-src ${APP_ORIGIN} data:`,
    `font-src ${APP_ORIGIN}`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
].join('; ');

const MIME_TYPES = Object.freeze({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
});

const SECURITY_HEADERS = Object.freeze({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
});

protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true },
}]);

/**
 * Resolves a request path to a real file inside one of the servable roots.
 * Returns null for anything outside them.
 */
const resolveServablePath = (requestPath) => {
    const decoded = decodeURIComponent(requestPath).replace(/^\/+/, '');
    const candidate = path.resolve(PROJECT_ROOT, decoded);

    const permitted = SERVABLE_ROOTS.some(
        (root) => candidate === root || candidate.startsWith(root + path.sep),
    );
    return permitted ? candidate : null;
};

const respond = (body, status, contentType) =>
    new Response(body, { status, headers: { ...SECURITY_HEADERS, 'Content-Type': contentType } });

/** Serves the renderer and the audit core over `app://` with security headers attached. */
const handleAppProtocol = async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = resolveServablePath(pathname);

    if (!filePath) return respond('Forbidden', 403, 'text/plain; charset=utf-8');

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()];
    if (!contentType) return respond('Unsupported media type', 415, 'text/plain; charset=utf-8');

    try {
        const body = await fs.readFile(filePath);
        return respond(body, 200, contentType);
    } catch {
        return respond('Not found', 404, 'text/plain; charset=utf-8');
    }
};

/**
 * Cuts the renderer off from the network.
 *
 * Nothing in the audit path needs a remote host, so rather than trusting every
 * future line of renderer code to stay offline, every request that is not the
 * app's own scheme is cancelled here.
 */
const enforceOfflineSession = (targetSession) => {
    targetSession.webRequest.onBeforeRequest((details, callback) => {
        const allowed = details.url.startsWith(`${APP_SCHEME}://`)
            || details.url.startsWith('devtools://')
            || details.url.startsWith('blob:')
            || details.url.startsWith('data:');
        if (!allowed) console.warn(`[bittax] blocked outbound request: ${details.url}`);
        callback({ cancel: !allowed });
    });

    targetSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    targetSession.setPermissionCheckHandler(() => false);
};

/** Denies navigation away from the app and refuses to open new windows. */
const lockDownNavigation = (contents) => {
    contents.on('will-navigate', (event, url) => {
        if (!url.startsWith(`${APP_ORIGIN}/`)) {
            event.preventDefault();
            console.warn(`[bittax] blocked navigation to: ${url}`);
        }
    });

    contents.setWindowOpenHandler(({ url }) => {
        console.warn(`[bittax] blocked window.open to: ${url}`);
        return { action: 'deny' };
    });

    contents.on('will-attach-webview', (event) => event.preventDefault());
};

const buildMenu = () => {
    const viewSubmenu = [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }];
    // DevTools stay out of packaged builds: an opened console is the easiest
    // way to talk a user through pasting something harmful into their own app.
    if (IS_DEV) viewSubmenu.push({ type: 'separator' }, { role: 'toggleDevTools' });

    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: 'File', submenu: [{ role: 'quit' }] },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
                { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
                { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' },
            ],
        },
        { label: 'View', submenu: viewSubmenu },
    ]));
};

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 960,
        minHeight: 640,
        backgroundColor: '#12141a',
        show: false,
        webPreferences: {
            preload: path.join(PROJECT_ROOT, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            sandbox: true,
            webviewTag: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            spellcheck: false,
            devTools: IS_DEV,
        },
    });

    win.once('ready-to-show', () => win.show());
    win.loadURL(ENTRY_URL);
    return win;
};

require('./src/main/ipc.js').registerIpcHandlers({ ipcMain, dialog, safeStorage, app, BrowserWindow });

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const [existing] = BrowserWindow.getAllWindows();
        if (existing) {
            if (existing.isMinimized()) existing.restore();
            existing.focus();
        }
    });

    app.enableSandbox();

    app.on('web-contents-created', (_event, contents) => lockDownNavigation(contents));

    app.whenReady().then(() => {
        protocol.handle(APP_SCHEME, handleAppProtocol);
        enforceOfflineSession(session.defaultSession);
        buildMenu();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}

// Exported for the path-containment tests, which must be able to prove that
// `app://` cannot reach outside the servable roots.
module.exports = { CONTENT_SECURITY_POLICY, resolveServablePath, ENTRY_URL };
