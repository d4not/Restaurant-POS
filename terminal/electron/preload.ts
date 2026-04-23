import { contextBridge, ipcRenderer } from 'electron';

// Bridge exposed to the renderer as `window.electron`. The renderer never
// gets direct access to ipcRenderer — every channel is named here so the main
// process can ignore unknown messages.

type PrinterResult = { ok: boolean; message?: string };
type PrinterKind = 'receipt' | 'kitchen';

export type PrinterBrand = 'EPSON' | 'STAR' | 'TANCA' | 'DARUMA' | 'BROTHER' | 'CUSTOM';
export type InterfaceType = 'USB' | 'NETWORK';

export interface PrinterConfig {
  type: PrinterBrand;
  interface_type: InterfaceType;
  interface: string;
  width: number;
  enabled: boolean;
}

export interface PrinterStore {
  receipt: PrinterConfig;
  kitchen: PrinterConfig;
}

// The main process accepts fully-structured ticket payloads; the renderer
// builds them from the API response. Typed `unknown` at the bridge boundary
// so an older/newer renderer doesn't crash the main — the main validates the
// shape it actually uses.
const api = {
  // Kitchen ticket — called after POST /orders/:id/send-to-kitchen.
  printKitchen: (payload: unknown): Promise<PrinterResult> =>
    ipcRenderer.invoke('printer:kitchen', payload),

  // Receipt — called after a successful payment (Phase 4).
  printReceipt: (payload: unknown): Promise<PrinterResult> =>
    ipcRenderer.invoke('printer:receipt', payload),

  // Settings page helpers.
  getPrinterConfig: (): Promise<PrinterStore> =>
    ipcRenderer.invoke('printer:get-config'),
  setPrinterConfig: (
    kind: PrinterKind,
    patch: Partial<PrinterConfig>,
  ): Promise<PrinterConfig> =>
    ipcRenderer.invoke('printer:set-config', kind, patch),
  probePrinter: (kind: PrinterKind): Promise<PrinterResult> =>
    ipcRenderer.invoke('printer:probe', kind),
  printTestPage: (kind: PrinterKind): Promise<PrinterResult> =>
    ipcRenderer.invoke('printer:test', kind),

  // Useful for the about screen / status bar — surface the actual versions
  // running, not the ones in package.json (which can drift in a dev rebuild).
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
};

contextBridge.exposeInMainWorld('electron', api);

export type ElectronApi = typeof api;
