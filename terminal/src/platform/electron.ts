// Electron implementation of PlatformBridge. Wraps window.electron IPC for
// printing; falls back to localStorage / navigator.onLine for everything that
// doesn't have a native Electron equivalent in this app.
import type {
  PlatformBridge,
  PrintKitchenResult,
  PrintReceiptResult,
  PrinterStatusInfo,
} from './types';

function ensureBridge(): NonNullable<Window['electron']> {
  if (!window.electron) {
    throw new Error('Electron bridge unavailable');
  }
  return window.electron;
}

export const electronBridge: PlatformBridge = {
  print: {
    async kitchen(orderId: string): Promise<PrintKitchenResult> {
      // Desktop print routes through the native ESC/POS service in the main
      // process. The renderer hands off the order id; the main process loads
      // the order itself via the API or its cached copy. For now, since the
      // existing window.electron.printer.printKitchen takes a payload, we
      // surface a stub here — the existing direct callers in TableDetail /
      // OrderRow keep working as before.
      void orderId;
      throw new Error('Use window.electron.printer.printKitchen directly on desktop');
    },
    async receipt(orderId: string): Promise<PrintReceiptResult> {
      void orderId;
      throw new Error('Use window.electron.printer.printReceipt directly on desktop');
    },
    async status(): Promise<PrinterStatusInfo> {
      const raw = await ensureBridge().printer.status();
      return {
        kitchen: { configured: raw.kitchen, connected: raw.kitchen, ip: '', port: 9100 },
        receipt: { configured: raw.receipt, connected: raw.receipt, ip: '', port: 9100 },
        paper_width: 80,
      };
    },
  },
  storage: {
    async get(key: string): Promise<string | null> {
      return window.localStorage.getItem(key);
    },
    async set(key: string, value: string): Promise<void> {
      window.localStorage.setItem(key, value);
    },
    async remove(key: string): Promise<void> {
      window.localStorage.removeItem(key);
    },
  },
  haptics: {
    tap() {
      /* no-op on desktop */
    },
    success() {
      /* no-op on desktop */
    },
    error() {
      /* no-op on desktop */
    },
  },
  network: {
    async isConnected(): Promise<boolean> {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    },
    onStatusChange(cb) {
      const online = () => cb(true);
      const offline = () => cb(false);
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      return () => {
        window.removeEventListener('online', online);
        window.removeEventListener('offline', offline);
      };
    },
  },
  app: {
    async openAdmin(token, userId) {
      await ensureBridge().app.openAdmin({ token, userId });
    },
  },
};
