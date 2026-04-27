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
