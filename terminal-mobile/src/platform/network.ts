// Connectivity adapter backed by @capacitor/network. The shared bridge contract
// expects a one-shot `isConnected()` and a subscribe-style `onStatusChange` —
// the Capacitor plugin already exposes both shapes (getStatus + addListener),
// so this is a thin pass-through.
import { Network } from '@capacitor/network';

export async function isConnected(): Promise<boolean> {
  const status = await Network.getStatus();
  return status.connected;
}

export function onStatusChange(cb: (connected: boolean) => void): () => void {
  // addListener returns a Promise<PluginListenerHandle>. We capture it
  // synchronously so callers can dispose without awaiting registration.
  const handlePromise = Network.addListener('networkStatusChange', (status) => {
    cb(status.connected);
  });
  return () => {
    handlePromise.then((handle) => handle.remove()).catch(() => {
      /* listener already torn down */
    });
  };
}
