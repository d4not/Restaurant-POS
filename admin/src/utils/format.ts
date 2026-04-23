import { format as formatFn, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { usePreferencesStore } from '../store/preferences';

const number = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

// The store lookup is intentionally non-reactive here: `formatMoney` is a
// plain function called during render, not a hook. The reactive part lives at
// the App root (see App.tsx), which subscribes to `usePreferencesStore` so any
// preference change triggers a subtree re-render — which re-runs every call
// site with the fresh preference. Keep this function hook-free so it can be
// used in callbacks, useMemo deps, etc. without violating Rules of Hooks.
function currencyFormatter(): Intl.NumberFormat {
  const code = usePreferencesStore.getState().currency;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
}

/** Currency code of the active preference (e.g. "MXN", "USD"). */
export function currencyCode(): string {
  return usePreferencesStore.getState().currency;
}

/** "Label (CUR)" suffix for form labels that take a monetary value. */
export function moneyLabel(base: string): string {
  return `${base} (${currencyCode()})`;
}

/** Parse a user-entered amount (e.g. "500.00") into integer centavos. */
export function amountToCentavos(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

/** Centavos → localized currency string using the user's preferred currency. */
export function formatMoney(centavos: number | string): string {
  const n = typeof centavos === 'string' ? Number(centavos) : centavos;
  const fmt = currencyFormatter();
  if (!Number.isFinite(n)) return fmt.format(0);
  return fmt.format(n / 100);
}

export function formatNumber(value: number | string, fractionDigits = 2): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

export function formatPct(value: number | string, fractionDigits = 1): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `${number.format(Number(n.toFixed(fractionDigits)))}%`;
}

type DateInput = string | Date;

function asDate(input: DateInput): Date {
  return typeof input === 'string' ? parseISO(input) : input;
}

function defaultDatePattern(): string {
  // date-fns tokens: dd (day), MM (month), yyyy (year).
  const pref = usePreferencesStore.getState().dateFormat;
  return pref === 'DD/MM/YYYY' ? 'dd/MM/yyyy' : 'MM/dd/yyyy';
}

export function formatDate(input: DateInput, pattern?: string): string {
  return formatFn(asDate(input), pattern ?? defaultDatePattern(), { locale: enUS });
}

export function formatDateShort(input: DateInput): string {
  return formatFn(asDate(input), 'MMM d', { locale: enUS });
}

export function formatDateTime(input: DateInput): string {
  return formatFn(asDate(input), `${defaultDatePattern()} · HH:mm`, { locale: enUS });
}

export function formatTopbarDate(date = new Date()): string {
  return formatFn(date, 'eee, MMM d, yyyy', { locale: enUS });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
