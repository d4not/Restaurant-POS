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
  // Printer config consumed by src/modules/print. Stored as opaque strings;
  // print-service parses them on read (port → number, paper_width → 58|80).
  PRINTER_KITCHEN_IP: 'printer_kitchen_ip',
  PRINTER_KITCHEN_PORT: 'printer_kitchen_port',
  PRINTER_RECEIPT_IP: 'printer_receipt_ip',
  PRINTER_RECEIPT_PORT: 'printer_receipt_port',
  PRINTER_PAPER_WIDTH: 'printer_paper_width',
  BUSINESS_NAME: 'business_name',
  BUSINESS_ADDRESS: 'business_address',
  LANGUAGE: 'language',
  // ISO 4217 code, currently constrained to MXN | USD by the print pipeline.
  // Snapshotted onto DailyReport at close time so old reports keep their
  // currency even if the operator changes it later.
  CURRENCY: 'currency',
  // Alert thresholds — consumed at shift close to decide which Alert rows to
  // create. Defaults match REPORTS-SPEC §4.3 and the migration seed; the close
  // path falls back to those defaults if a key was wiped (e.g. by a test that
  // truncated the settings table).
  ALERT_CASH_SHORTAGE_THRESHOLD: 'alert_cash_shortage_threshold',
  ALERT_CASH_SURPLUS_THRESHOLD: 'alert_cash_surplus_threshold',
  ALERT_MAX_VOIDS_PER_SHIFT: 'alert_max_voids_per_shift',
  ALERT_MAX_DISCOUNT_PCT: 'alert_max_discount_pct',
} as const;

export const ALERT_THRESHOLD_DEFAULTS = {
  CASH_SHORTAGE: 2000,
  CASH_SURPLUS: 2000,
  MAX_VOIDS_PER_SHIFT: 3,
  MAX_DISCOUNT_PCT: 10,
} as const;

export const PRINTER_DEFAULTS = {
  PORT: '9100',
  PAPER_WIDTH: '80',
} as const;

export const LANGUAGE_DEFAULT = 'en';
export const LANGUAGE_VALUES = ['en', 'es'] as const;
export type LanguageCode = (typeof LANGUAGE_VALUES)[number];

export const updateLanguageSchema = z.object({
  value: z.enum(LANGUAGE_VALUES),
});
export type UpdateLanguageInput = z.infer<typeof updateLanguageSchema>;

export const CURRENCY_DEFAULT = 'MXN';
export const CURRENCY_VALUES = ['MXN', 'USD'] as const;
export type CurrencyCode = (typeof CURRENCY_VALUES)[number];
