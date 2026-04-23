/**
 * Format centavos (string or number, tax-inclusive integers as stored on the
 * backend) into a human currency string. Kept in one place so the terminal's
 * receipt strings and cart totals stay consistent.
 */
export function formatMoney(centavos: string | number | null | undefined): string {
  if (centavos === null || centavos === undefined || centavos === '') return '—';
  const n = typeof centavos === 'string' ? Number(centavos) : centavos;
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n) / 100;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * "5m ago", "2h ago", "Just now". We only care about coarse elapsed time for
 * table cards — precision past the minute is visual noise.
 */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'Just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const leftover = mins % 60;
  if (hrs < 24) return leftover === 0 ? `${hrs}h` : `${hrs}h ${leftover}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
