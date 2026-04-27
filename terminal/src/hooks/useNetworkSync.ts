import { useEffect } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { getBridge } from '../platform';

// Sync TanStack Query's onlineManager with the platform bridge. The default
// online detection reads navigator.onLine, which is reliable on Electron but
// can lie on Android WebView (it sometimes returns true even when the device
// has no working transport). Wiring the bridge in means our offline banner
// and Query's "is online?" gate share one source of truth, so reconnects
// trigger automatic refetches across active queries.
//
// Mount once, near the React root. Idempotent: re-mounting is a no-op the
// onlineManager already deduplicates listeners by reference.
export function useNetworkSync(): void {
  useEffect(() => {
    const bridge = getBridge();
    let cancelled = false;
    bridge.network
      .isConnected()
      .then((value) => {
        if (!cancelled) onlineManager.setOnline(value);
      })
      .catch(() => {
        /* keep whatever the default is */
      });
    const dispose = bridge.network.onStatusChange((value) => {
      onlineManager.setOnline(value);
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, []);
}
