import { api } from './client';

// The backend stores settings as opaque string values keyed by name. We pull
// the full map once per session and pick out the receipt-relevant fields
// (business_name, business_address) when printing.
export type SettingsMap = Record<string, string>;

export function listSettings(): Promise<SettingsMap> {
  return api.get<SettingsMap>('/settings');
}

// Well-known keys for the terminal. Kept alongside the fetch so a typo at the
// call site surfaces as a TS error. Extend as the receipt grows new fields.
export const TERMINAL_SETTING_KEYS = {
  BUSINESS_NAME: 'business_name',
  BUSINESS_ADDRESS: 'business_address',
} as const;
