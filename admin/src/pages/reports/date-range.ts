/**
 * Shared helpers for date-range report pages.
 * Reports accept two YYYY-MM-DD local date inputs and translate them into
 * ISO timestamps spanning the full day (from = 00:00, to = 23:59:59.999).
 */

export interface DateRange {
  /** YYYY-MM-DD */ from: string;
  /** YYYY-MM-DD */ to: string;
}

export function toIsoDayStart(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function toIsoDayEnd(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function daysAgoYMD(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return ymd(d);
}

export function todayYMD(): string {
  return ymd(new Date());
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
