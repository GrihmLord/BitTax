const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Enable Copy/Paste/SelectAll in Electron on Windows
const createMenu = () => {
    const template = [
        {
            label: 'File',
            submenu: [{ role: 'quit' }]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { role: 'selectall' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggledevtools' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
};

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // For simple prototype
        },
    });

    // Force load local audit demo for Phase 3 Desktop Pivot
    win.loadFile(path.join(__dirname, 'audit_demo.html'));
}

app.whenReady().then(() => {
    createMenu();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
