import { api } from './client';
import type { TakeoutChannel } from './orders';

export type SettingsMap = Record<string, string>;

export function fetchSettings(): Promise<SettingsMap> {
  return api.get<SettingsMap>('/settings');
}

export type LanguageCode = 'en' | 'es';

export async function fetchLanguageSetting(): Promise<LanguageCode> {
  const data = await api.get<{ value: string }>('/settings/language');
  return data.value === 'es' ? 'es' : 'en';
}

export async function updateLanguageSetting(
  value: LanguageCode,
): Promise<LanguageCode> {
  const data = await api.patch<{ value: string }>('/settings/language', {
    value,
  });
  return data.value === 'es' ? 'es' : 'en';
}

const CHANNEL_KEY: Record<TakeoutChannel, string> = {
  LOCAL: 'takeout_channel_local_active',
  DELIVERY_LOCAL: 'takeout_channel_delivery_local_active',
  DELIVERY_APP: 'takeout_channel_delivery_app_active',
};

// A channel is "enabled" unless its setting is the explicit string "false".
// Missing keys count as enabled — that matches the migration default and
// avoids surprising blackouts when the row got cleared.
export function channelEnabled(
  settings: SettingsMap | undefined,
  channel: TakeoutChannel,
): boolean {
  if (!settings) return true;
  return settings[CHANNEL_KEY[channel]] !== 'false';
}

export const ALL_TAKEOUT_CHANNELS: TakeoutChannel[] = [
  'LOCAL',
  'DELIVERY_LOCAL',
  'DELIVERY_APP',
];

export const TAKEOUT_CHANNEL_LABEL: Record<TakeoutChannel, string> = {
  LOCAL: 'Local pickup',
  DELIVERY_LOCAL: 'Local delivery',
  DELIVERY_APP: 'Delivery app',
};

export const TAKEOUT_CHANNEL_HINT: Record<TakeoutChannel, string> = {
  LOCAL: 'Customer waiting at the counter',
  DELIVERY_LOCAL: 'Restaurant-driven delivery',
  DELIVERY_APP: 'Uber Eats / DiDi Food / Rappi',
};
