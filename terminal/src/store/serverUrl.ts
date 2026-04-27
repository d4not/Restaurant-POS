// Persisted backend base URL. Stored via the platform bridge so mobile uses
// Capacitor Preferences (survives app updates) and Electron falls through to
// localStorage. Read once at startup via `bootstrapServerUrl()`; the API
// client keeps a synchronous mirror so request() doesn't have to await.
import { getBridge, getPlatformId } from '../platform';

const STORAGE_KEY = 'pos-terminal-server-url';

// Mobile default is read at build time from VITE_MOBILE_DEFAULT_SERVER_URL so
// each deployment can bake in its own LAN address. When unset the value is an
// empty string and the PIN screen shows a "Configure server" affordance so the
// operator can point the app at their backend on first launch.
export const MOBILE_DEFAULT_SERVER_URL: string =
  import.meta.env.VITE_MOBILE_DEFAULT_SERVER_URL ?? '';

export async function loadServerUrl(): Promise<string | null> {
  try {
    return await getBridge().storage.get(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function saveServerUrl(url: string): Promise<void> {
  await getBridge().storage.set(STORAGE_KEY, url.trim());
}

export async function clearServerUrl(): Promise<void> {
  await getBridge().storage.remove(STORAGE_KEY);
}

// Derive the default we should suggest in the Settings UI when nothing is
// persisted yet. Capacitor builds get the LAN default; everything else gets an
// empty string (the legacy resolver in client.ts handles the fallbacks).
export function defaultServerUrlForPlatform(): string {
  return getPlatformId() === 'capacitor' ? MOBILE_DEFAULT_SERVER_URL : '';
}
