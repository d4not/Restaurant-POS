import { format as formatFn, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { usePreferencesStore } from '../store/preferences';

const number = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

function currencyFormatter(): Intl.NumberFormat {
  const code = usePreferencesStore.getState().currency;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
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
