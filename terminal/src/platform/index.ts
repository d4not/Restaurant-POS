// Platform bridge resolver. Mobile (Capacitor) registers its bridge in
// main-mobile.tsx before React mounts; desktop (Electron) and the web fallback
// resolve lazily based on what's on `window`. Renderer code that needs a
// native capability calls `getBridge()` instead of importing per-platform
// modules — keeps terminal/src/ free of @capacitor/* imports per CLAUDE.md.
import type { PlatformBridge, PlatformId } from './types';
import { electronBridge } from './electron';

let registered: { id: PlatformId; bridge: PlatformBridge } | null = null;

export function registerPlatform(id: PlatformId, bridge: PlatformBridge): void {
  registered = { id, bridge };
}

export function getPlatformId(): PlatformId {
  if (registered) return registered.id;
  if (typeof window !== 'undefined' && window.electron) return 'electron';
  return 'web';
}

export function getBridge(): PlatformBridge {
  if (registered) return registered.bridge;
  if (typeof window !== 'undefined' && window.electron) return electronBridge;
  // Web fallback: print throws (Settings UI degrades gracefully via
  // window.electron checks); storage/haptics/network use the DOM.
  return {
    print: {
      async kitchen() {
        throw new Error('Printing not available in this build');
      },
      async receipt() {
        throw new Error('Printing not available in this build');
      },
      async status() {
        return {
          kitchen: { configured: false, connected: false, ip: '', port: 9100 },
          receipt: { configured: false, connected: false, ip: '', port: 9100 },
          paper_width: 80,
        };
      },
    },
    storage: electronBridge.storage,
    haptics: electronBridge.haptics,
    network: electronBridge.network,
    app: {
      async openAdmin(token, userId) {
        // No native shell here — pop the admin into a new tab against whatever
        // host this build is running under. The admin's Login page picks up
        // the token/uid query params and signs the operator in automatically.
        const base = typeof window !== 'undefined' ? window.location.origin : '';
        const url = `${base}/admin/login?token=${encodeURIComponent(token)}&uid=${encodeURIComponent(userId)}`;
        if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener');
        }
      },
    },
  };
}

export type { PlatformBridge, PlatformId } from './types';
