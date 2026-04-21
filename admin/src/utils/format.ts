import { format as formatFn, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

const number = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 2,
});

/** Centavos → localized MXN string. Always pass integer centavos, never floats. */
export function formatMoney(centavos: number | string): string {
  const n = typeof centavos === 'string' ? Number(centavos) : centavos;
  if (!Number.isFinite(n)) return currency.format(0);
  return currency.format(n / 100);
}

export function formatNumber(value: number | string, fractionDigits = 2): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-MX', {
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

export function formatDate(input: DateInput, pattern = 'd MMM yyyy'): string {
  return formatFn(asDate(input), pattern, { locale: es });
}

export function formatDateShort(input: DateInput): string {
  return formatFn(asDate(input), 'd MMM', { locale: es });
}

export function formatDateTime(input: DateInput): string {
  return formatFn(asDate(input), "d MMM yyyy · HH:mm", { locale: es });
}

export function formatTopbarDate(date = new Date()): string {
  return formatFn(date, 'eee, d MMM yyyy', { locale: es }).replace(/^./, (c) => c.toLowerCase());
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
