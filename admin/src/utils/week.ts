/**
 * UTC week helpers — Monday-anchored like the payroll backend expects.
 * All arithmetic is performed in UTC so timezone drift doesn't shift which
 * calendar day a timestamp lands on.
 */

function toUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Monday of the UTC week containing `date`. */
export function mondayOfWeekUtc(date: Date): Date {
  const d = toUtcMidnight(date);
  const day = d.getUTCDay(); // Sun=0, Mon=1, ..., Sat=6
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset));
}

export function addDaysUtc(date: Date, days: number): Date {
  const d = toUtcMidnight(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

export function daysOfWeekUtc(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDaysUtc(monday, i));
}

/** Format a Date as YYYY-MM-DD in UTC. Matches the date column format. */
export function utcDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True if d1 and d2 are the same UTC calendar day. */
export function sameUtcDay(a: Date, b: Date): boolean {
  return utcDateKey(a) === utcDateKey(b);
}

export function isFutureDay(d: Date, now = new Date()): boolean {
  return toUtcMidnight(d).getTime() > toUtcMidnight(now).getTime();
}
