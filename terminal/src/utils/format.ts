// Currency: backend stores integer centavos, transmits as string. Render as
// MXN; we never operate on the JS float value beyond formatting.
const MONEY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'MXN',
  currencyDisplay: 'narrowSymbol',
});

export function formatMoney(centavos: string | number): string {
  const value = typeof centavos === 'string' ? Number(centavos) : centavos;
  if (!Number.isFinite(value)) return '—';
  return MONEY_FORMATTER.format(value / 100);
}

// Same as formatMoney but without the symbol; used in tight columns where the
// $ would compete with surrounding text for visual weight.
const PLAIN_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoneyPlain(centavos: string | number): string {
  const value = typeof centavos === 'string' ? Number(centavos) : centavos;
  if (!Number.isFinite(value)) return '—';
  return PLAIN_FORMATTER.format(value / 100);
}

// Elapsed minutes since `iso`. Floor on the minute boundary so a 1-minute-old
// order doesn't flicker between "0 min" and "1 min" within the same render.
export function minutesSince(iso: string | Date): number {
  const then = typeof iso === 'string' ? new Date(iso) : iso;
  const ms = Date.now() - then.getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}

export function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export type TimeStatus = 'fresh' | 'warm' | 'hot';

// Wireframe spec: green <10min, gold 10–25min, red 25+min. The thresholds are
// time-based service expectations — fresh = on track, warm = watch this,
// hot = needs intervention.
export function getTimeStatus(minutes: number): TimeStatus {
  if (minutes < 10) return 'fresh';
  if (minutes < 25) return 'warm';
  return 'hot';
}

export function timeStatusColor(status: TimeStatus): string {
  switch (status) {
    case 'fresh':
      return 'var(--green)';
    case 'warm':
      return 'var(--gold)';
    case 'hot':
      return 'var(--red)';
  }
}
