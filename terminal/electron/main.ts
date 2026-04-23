import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getConfig,
  printKitchen,
  printReceipt,
  printTestPage,
  probe,
  setConfig,
  type KitchenTicket,
  type PrinterConfig,
  type ReceiptTicket,
} from './printer.js';

// vite-plugin-electron sets these env vars at dev time. In a packaged build
// they're undefined and we fall back to the on-disk renderer bundle.
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#1a1210',
    title: 'Restaurant POS — Terminal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // Open dev tools in dev so renderer errors are visible immediately.
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
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

// Quit on every platform when all windows close — terminals are kiosk-style,
// no menu bar background lifecycle needed.
app.on('window-all-closed', () => {
  app.quit();
});

// ── Printer IPC ──────────────────────────────────────────────────────
// Every channel name is prefixed "printer:" so the preload's allowlist stays
// easy to read. Payload shapes match the PrinterConfig / ticket types in
// printer.ts — the renderer's typings (src/types/electron.d.ts) mirror these.

ipcMain.handle('printer:get-config', async () => getConfig());

ipcMain.handle(
  'printer:set-config',
  async (_ev, kind: 'receipt' | 'kitchen', patch: Partial<PrinterConfig>) =>
    setConfig(kind, patch),
);

ipcMain.handle('printer:probe', async (_ev, kind: 'receipt' | 'kitchen') =>
  probe(kind),
);

ipcMain.handle('printer:test', async (_ev, kind: 'receipt' | 'kitchen') =>
  printTestPage(kind),
);

ipcMain.handle(
  'printer:kitchen',
  async (_ev, payload: KitchenTicket) => printKitchen(payload),
);

ipcMain.handle(
  'printer:receipt',
  async (_ev, payload: ReceiptTicket) => printReceipt(payload),
);
