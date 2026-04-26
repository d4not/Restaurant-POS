// Electron main process — kept as plain CommonJS so it runs directly without a
// bundler step. The renderer is built by Vite (ESM) and loaded via file:// in
// prod or http://localhost:5173 in dev (set ELECTRON_DEV=1 to switch).
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const printerService = require('./printer.cjs');

const IS_DEV = process.env.ELECTRON_DEV === '1';

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#f5f0e8',
    title: 'Restaurant POS',
    autoHideMenuBar: true,
    webPreferences: {
      // CJS preload — must be a .cjs file so Electron loads it as CommonJS even
      // though package.json declares "type": "module". Sandbox stays on for
      // security; preload exposes a thin API surface to the renderer.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the system browser instead of a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (IS_DEV) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Printing IPC — backed by the node-thermal-printer service. Each handler
// returns a serialisable result; the renderer reads `ok` and surfaces errors
// inline. Print failures don't block the order flow — the backend is the
// source of truth for "sent to kitchen" / "paid" status.
ipcMain.handle('printer:status', () => printerService.getStatus());
ipcMain.handle('printer:print-kitchen', (_event, data) => printerService.printKitchen(data));
ipcMain.handle('printer:print-receipt', (_event, data) => printerService.printReceipt(data));
ipcMain.handle('printer:get-config', () => printerService.loadConfig());
ipcMain.handle('printer:set-config', (_event, next) => printerService.saveConfig(next));
ipcMain.handle('printer:test-print', (_event, role) => printerService.testPrint(role));
