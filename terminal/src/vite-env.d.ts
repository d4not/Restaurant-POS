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

type DetectedPrinterKind = 'system' | 'device';
type DetectedPrinterStatus =
  | 'ready'
  | 'busy'
  | 'stopped'
  | 'attention'
  | 'permission_denied'
  | 'unknown';

interface DetectedPrinter {
  id: string;
  kind: DetectedPrinterKind;
  label: string;
  // Value to drop into PrinterRoleConfig.address. For system printers it is
  // "printer:NAME"; for raw Linux devices it is the absolute device path.
  address: string;
  port: string | null;
  isUsb: boolean;
  canWrite: boolean;
  isDefault: boolean;
  status: DetectedPrinterStatus;
  description?: string | null;
  note?: string | null;
}

interface DetectedPrintersResult {
  platform: NodeJS.Platform;
  printers: DetectedPrinter[];
  counts: { system: number; device: number; usb: number };
}

type PrinterRecommendation =
  | 'use-current'
  | 'investigate-current'
  | 'switch-primary'
  | 'pick-primary'
  | 'permission-issue'
  | 'no-printer-available';

interface PrinterScoredCandidate {
  candidate: DetectedPrinter;
  score: number;
  reasons: string[];
}

interface PrinterResolverPlan {
  currentAddress: string | null;
  currentMatch: DetectedPrinter | null;
  recommendation: PrinterRecommendation;
  primary: DetectedPrinter | null;
  alternatives: DetectedPrinter[];
  scoredCandidates: PrinterScoredCandidate[];
  reasoning: string;
}

interface PrinterResolveRoleResult {
  currentConfig: PrinterRoleConfig;
  plan: PrinterResolverPlan;
}

interface PrinterResolveResult {
  platform: NodeJS.Platform;
  counts: { system: number; device: number; usb: number };
  receipt: PrinterResolveRoleResult;
  kitchen: PrinterResolveRoleResult;
}

interface ElectronBridge {
  printer: {
    status: () => Promise<PrinterStatus>;
    printKitchen: (data: unknown) => Promise<PrinterResult>;
    printReceipt: (data: unknown) => Promise<PrinterResult>;
    getConfig: () => Promise<PrinterConfig>;
    setConfig: (next: Partial<PrinterConfig>) => Promise<PrinterConfig>;
    testPrint: (role: PrinterRole) => Promise<PrinterResult>;
    listUsb: () => Promise<DetectedPrintersResult>;
    resolve: () => Promise<PrinterResolveResult>;
    applyCandidate: (payload: { role: PrinterRole; candidate: DetectedPrinter }) => Promise<{ ok: boolean; config?: PrinterConfig; error?: string }>;
    markWorking: (payload: { role: PrinterRole; address: string }) => Promise<{ ok: boolean }>;
  };
  app: {
    openAdmin: (payload: { token: string; userId: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  platform: NodeJS.Platform;
  isElectron: boolean;
}

interface Window {
  electron?: ElectronBridge;
}
