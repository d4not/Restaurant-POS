// Renderer-side ambient declaration for the IPC bridge defined in
// electron/preload.ts. Keeps the renderer typed even though the bridge code
// lives in a separate tsconfig.

export type PrinterBrand = 'EPSON' | 'STAR' | 'TANCA' | 'DARUMA' | 'BROTHER' | 'CUSTOM';
export type InterfaceType = 'USB' | 'NETWORK';
export type PrinterKind = 'receipt' | 'kitchen';

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

export interface PrinterResult { ok: boolean; message?: string }

interface ElectronApi {
  printKitchen(payload: unknown): Promise<PrinterResult>;
  printReceipt(payload: unknown): Promise<PrinterResult>;

  getPrinterConfig(): Promise<PrinterStore>;
  setPrinterConfig(kind: PrinterKind, patch: Partial<PrinterConfig>): Promise<PrinterConfig>;
  probePrinter(kind: PrinterKind): Promise<PrinterResult>;
  printTestPage(kind: PrinterKind): Promise<PrinterResult>;

  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

declare global {
  interface Window {
    electron?: ElectronApi;
  }
}

export {};
