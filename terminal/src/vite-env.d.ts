/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MOBILE_DEFAULT_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Roles correspond one-to-one with the printer instances exposed by the
// service in electron/printer.cjs. Keep these strings in sync with the IPC.
type PrinterRole = 'receipt' | 'kitchen';
type PrinterConnection = 'usb' | 'network';

interface PrinterRoleConfig {
  enabled: boolean;
  type: 'epson' | 'star' | 'tanca' | 'daruma' | 'brother' | 'custom';
  connection: PrinterConnection;
  address: string;
  width: number;
  characterSet: string;
}

interface PrinterBusinessConfig {
  name: string;
  tax_id: string;
  address: string;
}

interface PrinterConfig {
  business: PrinterBusinessConfig;
  receipt: PrinterRoleConfig;
  kitchen: PrinterRoleConfig;
}

interface PrinterStatus {
  receipt: boolean;
  kitchen: boolean;
  checked_at: string;
}

interface PrinterResult {
  ok: boolean;
  error?: string;
}

interface ElectronBridge {
  printer: {
    status: () => Promise<PrinterStatus>;
    printKitchen: (data: unknown) => Promise<PrinterResult>;
    printReceipt: (data: unknown) => Promise<PrinterResult>;
    getConfig: () => Promise<PrinterConfig>;
    setConfig: (next: Partial<PrinterConfig>) => Promise<PrinterConfig>;
    testPrint: (role: PrinterRole) => Promise<PrinterResult>;
  };
  platform: NodeJS.Platform;
  isElectron: boolean;
}

interface Window {
  electron?: ElectronBridge;
}
