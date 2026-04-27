// Persisted backend base URL. Stored via the platform bridge so mobile uses
// Capacitor Preferences (survives app updates) and Electron falls through to
// localStorage. Read once at startup via `bootstrapServerUrl()`; the API
// client keeps a synchronous mirror so request() doesn't have to await.
import { getBridge, getPlatformId } from '../platform';

const STORAGE_KEY = 'pos-terminal-server-url';

// Mobile default points at the LAN IP from the deployment guide. Desktop and
// the Vite dev preview don't seed a value — their resolver picks localhost or
// the page hostname instead, which works without configuration.
export const MOBILE_DEFAULT_SERVER_URL = 'http://192.168.0.245:3000/api/v1';

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
