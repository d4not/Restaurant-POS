// Capacitor implementation of PlatformBridge. Composed from the per-capability
// adapter modules so each one stays small and testable. Registered with the
// shared resolver in main-mobile.tsx before React mounts; downstream calls to
// `getBridge()` from terminal/src/ then dispatch here automatically.
import type { PlatformBridge } from '@/platform/types';
import * as printer from './printer';
import * as storage from './storage';
import * as haptics from './haptics';
import * as network from './network';

export const capacitorBridge: PlatformBridge = {
  print: {
    kitchen: printer.printKitchen,
    receipt: printer.printReceipt,
    status: printer.printerStatus,
  },
  storage: {
    get: storage.get,
    set: storage.set,
    remove: storage.remove,
  },
  haptics: {
    tap: haptics.tap,
    success: haptics.success,
    error: haptics.error,
  },
  network: {
    isConnected: network.isConnected,
    onStatusChange: network.onStatusChange,
  },
  app: {
    // The mobile build doesn't host the admin panel — the tablet UI is POS-
    // only. Throwing here surfaces the message in the ModePicker so the
    // operator knows to use a desktop terminal instead.
    async openAdmin() {
      throw new Error('Admin Mode is not available on this device');
    },
  },
};
