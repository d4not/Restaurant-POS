import { z } from 'zod';

// All settings are simple string values. Modules that read them typecast on
// use — e.g. default_tax_id reads as a UUID or an empty string meaning "no
// default tax configured". Clients send a partial object of {key: value} and
// the service upserts each pair.
//
// The 50_000-char value cap is a global sanity guard against bloat — it
// applies uniformly to every key in the record (z.record has no per-key
// validation). The generous ceiling exists because `report_custom_css` and
// the report header/footer HTML can legitimately run several KB; smaller
// keys (business_name, printer_*, alert thresholds) just don't use the
// headroom in practice. Settings.value is TEXT in Postgres so the DB itself
// imposes no limit.
export const updateSettingsSchema = z
  .record(z.string().min(1).max(200), z.string().max(50_000))
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
  // Cash-handling polish (Track A — shifts overhaul). Consumed by the
  // denomination-counter close flow on the terminal and by the new
  // notifications module to decide which manager alerts to dispatch.
  //   notify   — manager is informed; close proceeds.
  //   blocking — close requires manager sign-off (force-close with reason).
  CASH_VARIANCE_NOTIFY_THRESHOLD: 'cash_variance_notify_threshold',
  CASH_VARIANCE_BLOCKING_THRESHOLD: 'cash_variance_blocking_threshold',
  // Hide MXN $0.50 / sub-cent coins from the counter UI by default — Daniel:
  // "los centavos actualmente ya casi no se usan." Operators in regions that
  // still circulate the small coins can opt out.
  CASH_COUNT_HIDE_SUBUNITS: 'cash_count_hide_subunits',
  // Render the close flow without the expected amount until submit — the
  // blind-close mode in REPORTS-SPEC §5.2.
  CASH_COUNT_DEFAULT_BLIND_MODE: 'cash_count_default_blind_mode',
  // Master switch for the notifications module. When `false`, dispatch is a
  // no-op; `GET /notifications` still works for reads.
  NOTIFICATIONS_ENABLED: 'notifications_enabled',
  // Quiet hours in 24-h "HH:mm" form. When the current local time falls
  // inside the window, dispatch suppresses non-critical events (everything
  // except ABOVE_BLOCKING_THRESHOLD-class).
  NOTIFICATIONS_QUIET_HOURS_START: 'notifications_quiet_hours_start',
  NOTIFICATIONS_QUIET_HOURS_END: 'notifications_quiet_hours_end',
  // Printable corte Z customisation — the admin "Report template" page lets
  // an ADMIN replace the bundled stylesheet, swap in a custom header/footer,
  // or hide individual sections. Empty / missing → fall back to defaults.
  REPORT_CUSTOM_CSS: 'report_custom_css',
  REPORT_CUSTOM_HEADER_HTML: 'report_custom_header_html',
  REPORT_CUSTOM_FOOTER_HTML: 'report_custom_footer_html',
  REPORT_SHOW_CASH: 'report_show_cash',
  REPORT_SHOW_SALES: 'report_show_sales',
  REPORT_SHOW_PAYMENTS: 'report_show_payments',
  REPORT_SHOW_SHIFTS: 'report_show_shifts',
  REPORT_SHOW_PRODUCTS: 'report_show_products',
  REPORT_SHOW_ALERTS: 'report_show_alerts',
  REPORT_SHOW_VERIFICATION: 'report_show_verification',
} as const;

// Section keys → tag used by the front-end editor. Default to true (section
// shown) when the row is missing or holds anything but the literal "false".
export const REPORT_SECTION_KEYS = [
  'cash',
  'sales',
  'payments',
  'shifts',
  'products',
  'alerts',
  'verification',
] as const;
export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

// Keys that only ADMIN may write through the bulk PATCH /settings endpoint.
// The report_custom_* keys are the XSS-relevant ones — they're interpolated
// raw into the printable-report HTML on purpose (so admins can paste a logo
// in the header, etc.), so write access has to match the trust model the
// renderer assumes. The non-printer business knobs are bundled in because
// they're operational decisions a cashier shouldn't be flipping silently.
// Printer keys stay off this list so the terminal's "Printer check" hub can
// keep assigning IPs as CASHIER+.
export const ADMIN_ONLY_SETTING_KEYS = [
  SETTING_KEYS.DEFAULT_TAX_ID,
  SETTING_KEYS.BUSINESS_NAME,
  SETTING_KEYS.BUSINESS_ADDRESS,
  SETTING_KEYS.CURRENCY,
  SETTING_KEYS.ALERT_CASH_SHORTAGE_THRESHOLD,
  SETTING_KEYS.ALERT_CASH_SURPLUS_THRESHOLD,
  SETTING_KEYS.ALERT_MAX_VOIDS_PER_SHIFT,
  SETTING_KEYS.ALERT_MAX_DISCOUNT_PCT,
  SETTING_KEYS.CASH_VARIANCE_NOTIFY_THRESHOLD,
  SETTING_KEYS.CASH_VARIANCE_BLOCKING_THRESHOLD,
  SETTING_KEYS.CASH_COUNT_HIDE_SUBUNITS,
  SETTING_KEYS.CASH_COUNT_DEFAULT_BLIND_MODE,
  SETTING_KEYS.NOTIFICATIONS_ENABLED,
  SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_START,
  SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_END,
  SETTING_KEYS.REPORT_CUSTOM_CSS,
  SETTING_KEYS.REPORT_CUSTOM_HEADER_HTML,
  SETTING_KEYS.REPORT_CUSTOM_FOOTER_HTML,
  SETTING_KEYS.REPORT_SHOW_CASH,
  SETTING_KEYS.REPORT_SHOW_SALES,
  SETTING_KEYS.REPORT_SHOW_PAYMENTS,
  SETTING_KEYS.REPORT_SHOW_SHIFTS,
  SETTING_KEYS.REPORT_SHOW_PRODUCTS,
  SETTING_KEYS.REPORT_SHOW_ALERTS,
  SETTING_KEYS.REPORT_SHOW_VERIFICATION,
] as const;

export const ALERT_THRESHOLD_DEFAULTS = {
  CASH_SHORTAGE: 2000,
  CASH_SURPLUS: 2000,
  MAX_VOIDS_PER_SHIFT: 3,
  MAX_DISCOUNT_PCT: 10,
} as const;

// Defaults applied when the cash-handling keys are missing (e.g. fresh
// install or a test that truncated `settings`). Centavos for the money
// fields; the close path falls back to these so a wiped table never breaks
// the cashier UI.
export const CASH_HANDLING_DEFAULTS = {
  // $50 — at or above the diff the UI prompts "notify your manager".
  VARIANCE_NOTIFY_THRESHOLD: 5_000,
  // $500 — at or above, the close is blocking and needs cashier+ sign-off.
  VARIANCE_BLOCKING_THRESHOLD: 50_000,
  HIDE_SUBUNITS: true,
  DEFAULT_BLIND_MODE: false,
  NOTIFICATIONS_ENABLED: false,
  // 22:00 → 07:00 by default — suppresses non-critical notifications outside
  // business hours. Operators in 24-h venues should set both to the same
  // value to disable the quiet window.
  QUIET_HOURS_START: '22:00',
  QUIET_HOURS_END: '07:00',
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
