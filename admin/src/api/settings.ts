import { api } from './client';

// The backend stores every setting as an opaque string; callers parse on read.
// Well-known keys live alongside consumers (e.g. default_tax_id in the Settings
// page) so typos surface at the use site.
export type SettingsMap = Record<string, string>;

export function listSettings() {
  return api.get<SettingsMap>('/settings');
}

export function updateSettings(patch: SettingsMap) {
  return api.patch<SettingsMap>('/settings', patch);
}
