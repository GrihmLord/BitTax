/**
 * main.js
 * Electron main process.
 *
 * Security posture, in order of importance:
 *   1. The renderer has no Node. contextIsolation on, sandbox on,
 *      nodeIntegration off. Every privileged action goes through a named,
 *      validated IPC channel declared in preload.cjs, and every handler checks
 *      that the call came from the app's own page.
 *   2. Content is served over a custom `app://` scheme so a strict
 *      Content-Security-Policy can be attached to real response headers,
 *      which a `file://` page cannot have.
 *   3. The network is switched off at the session level. This tool audits
 *      cold storage; nothing it holds should ever leave the machine, and an
 *      offline guarantee is worth more than a promise in a README.
 *   4. Navigation, redirects, new windows, permissions and webviews are all
 *      denied.
 */

import { app, BrowserWindow, Menu, protocol, session, dialog, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    APP_SCHEME, APP_ORIGIN, ENTRY_URL, createProtocolHandler, isPermittedRequest,
} from './src/main/protocol.js';
import { registerIpcHandlers } from './src/main/ipc.js';

/**
 * Development mode is opted into by an explicit flag rather than an
 * environment variable, so `npm run electron:dev` behaves the same on every
 * platform without pulling in a cross-platform env shim, and a packaged build
 * cannot be flipped into it by the environment it happens to run in.
 */
const IS_DEV = !app.isPackaged && process.argv.includes('--dev');

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true },
}]);

/**
 * Cuts the renderer off from the network.
 *
 * Nothing in the audit path needs a remote host, so rather than trusting every
 * future line of renderer code to stay offline, every request that is not the
 * app's own scheme is cancelled here.
 */
const enforceOfflineSession = (targetSession) => {
    targetSession.webRequest.onBeforeRequest((details, callback) => {
        const allowed = isPermittedRequest(details.url);
        if (!allowed) console.warn(`[bittax] blocked outbound request: ${details.url}`);
        callback({ cancel: !allowed });
    });

    targetSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    targetSession.setPermissionCheckHandler(() => false);
    targetSession.setDevicePermissionHandler(() => false);
    targetSession.on('will-download', (event) => event.preventDefault());
};

/** Denies navigation away from the app and refuses to open new windows. */
const lockDownNavigation = (contents) => {
    const guard = (event, url) => {
        if (!url.startsWith(`${APP_ORIGIN}/`)) {
            event.preventDefault();
            console.warn(`[bittax] blocked navigation to: ${url}`);
        }
    };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);

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

    const template = [
        { label: 'File', submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }] },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
                { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
                { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' },
            ],
        },
        { label: 'View', submenu: viewSubmenu },
    ];
    if (process.platform === 'darwin') template.unshift({ role: 'appMenu' });

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
            preload: path.join(PROJECT_ROOT, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            sandbox: true,
            webviewTag: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            navigateOnDragDrop: false,
            spellcheck: false,
            devTools: IS_DEV,
        },
    });

    win.once('ready-to-show', () => win.show());
    win.loadURL(ENTRY_URL);
    return win;
};

registerIpcHandlers({ ipcMain, dialog, safeStorage, app, BrowserWindow });

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
        protocol.handle(APP_SCHEME, createProtocolHandler(PROJECT_ROOT));
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
