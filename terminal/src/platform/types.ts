// Platform abstraction surface shared by the Electron desktop app and the
// Capacitor Android tablet app. Anything that touches a native API (printer,
// storage, haptics, connectivity) goes through this contract instead of being
// imported directly inside the React tree.
//
// The desktop bundle implements PlatformBridge with `window.electron` IPC; the
// mobile bundle implements it with backend HTTP + Capacitor plugins. The
// renderer code itself is platform-agnostic: it asks for `getBridge()` and
// uses whatever was registered.

export interface PrinterStatusInfo {
  kitchen: { configured: boolean; connected: boolean; ip: string; port: number };
  receipt: { configured: boolean; connected: boolean; ip: string; port: number };
  paper_width: number;
}

export interface PrintKitchenResult {
  ok: boolean;
  error?: string;
  printed_count: number;
  is_correction: boolean;
}

export interface PrintReceiptResult {
  ok: boolean;
  error?: string;
}

export interface PlatformBridge {
  print: {
    kitchen(orderId: string): Promise<PrintKitchenResult>;
    receipt(orderId: string): Promise<PrintReceiptResult>;
    status(): Promise<PrinterStatusInfo>;
  };
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  haptics: {
    tap(): void;
    success(): void;
    error(): void;
  };
  network: {
    isConnected(): Promise<boolean>;
    onStatusChange(cb: (connected: boolean) => void): () => void;
  };
}

export type PlatformId = 'electron' | 'capacitor' | 'web';
