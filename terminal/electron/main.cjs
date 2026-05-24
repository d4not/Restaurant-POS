// Electron main process — kept as plain CommonJS so it runs directly without a
// bundler step. The renderer is built by Vite (ESM) and loaded via file:// in
// prod or http://localhost:5173 in dev (set ELECTRON_DEV=1 to switch).
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const printerService = require('./printer.cjs');
const usbDiscovery = require('./usb-discovery.cjs');

const IS_DEV = process.env.ELECTRON_DEV === '1';

// Admin panel URL. In dev the admin Vite server runs on port 5174 by default;
// in production the admin ships as a built bundle served alongside the backend
// at /admin. Override via ADMIN_URL when packaging for a real deployment.
const ADMIN_URL = process.env.ADMIN_URL || (IS_DEV ? 'http://localhost:5174' : 'http://localhost:3000/admin');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let adminWindow = null;

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

// Enumerate USB / OS-spooler printers on demand. Settings → Printers calls
// this from the renderer when the operator taps "Detect". Needs a valid
// BrowserWindow to reach webContents.getPrintersAsync, so we lazy-pick any
// surviving window rather than capturing `mainWindow` (which can be null
// during early boot or after the user closes the primary window on macOS).
ipcMain.handle('printer:list-usb', async () => {
  const window =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
  return usbDiscovery.listDetectedPrinters(window);
});

// Mode picker: a MANAGER/ADMIN operator chose "Admin Mode" after PIN login.
// We pop the admin web app in a second window with the JWT pre-filled via
// query string so the operator skips the email/password form. The admin
// renderer reads ?token & ?uid in pages/Login.tsx and hydrates the session.
ipcMain.handle('app:open-admin', (_event, payload) => {
  const token = payload && typeof payload.token === 'string' ? payload.token : '';
  const userId = payload && typeof payload.userId === 'string' ? payload.userId : '';
  if (!token) {
    return { ok: false, error: 'Missing token' };
  }

  const url = `${ADMIN_URL.replace(/\/$/, '')}/login?token=${encodeURIComponent(token)}&uid=${encodeURIComponent(userId)}`;

  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.loadURL(url);
    adminWindow.focus();
    return { ok: true };
  }

  adminWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#f5f0e8',
    title: 'Restaurant POS — Admin',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  adminWindow.webContents.setWindowOpenHandler(({ url: next }) => {
    shell.openExternal(next);
    return { action: 'deny' };
  });

  adminWindow.loadURL(url);
  adminWindow.on('closed', () => {
    adminWindow = null;
  });

  return { ok: true };
});
