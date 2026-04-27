// Mobile key-value storage backed by @capacitor/preferences. Stored on disk
// inside the app's private SharedPreferences on Android — survives process
// kills and app updates, but wiped on uninstall. The shared bridge interface
// returns Promises, which matches the Preferences API directly.
import { Preferences } from '@capacitor/preferences';

export async function get(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key });
  return value ?? null;
}

export async function set(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value });
}

export async function remove(key: string): Promise<void> {
  await Preferences.remove({ key });
}
