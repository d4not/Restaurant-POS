import { z } from 'zod';

// All settings are simple string values. Modules that read them typecast on
// use — e.g. default_tax_id reads as a UUID or an empty string meaning "no
// default tax configured". Clients send a partial object of {key: value} and
// the service upserts each pair.
export const updateSettingsSchema = z
  .record(z.string().min(1).max(200), z.string().max(500))
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one setting must be provided',
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// Well-known keys — centralised so typos in other modules fail at compile time.
export const SETTING_KEYS = {
  DEFAULT_TAX_ID: 'default_tax_id',
} as const;
