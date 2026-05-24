/**
 * Pure helpers for the denomination-counting close flow. No React, no DOM —
 * safe to call from anywhere in the renderer (component, hook, test).
 */

export type CashBreakdown = Record<string, number>;

/** Sum of (denomination_centavos × count) across the breakdown. */
export function breakdownToCentavos(breakdown: CashBreakdown): number {
  let total = 0;
  for (const [denom, count] of Object.entries(breakdown)) {
    const d = Number(denom);
    const c = Number(count);
    if (!Number.isFinite(d) || !Number.isFinite(c) || d <= 0 || c <= 0) continue;
    total += d * Math.floor(c);
  }
  return total;
}

/**
 * Greedy "what denominations would make up this amount, largest-first" helper.
 * Used to seed a counter with a sensible default when the cashier wants to
 * pre-fill the expected breakdown, and to reset between counts. Returns the
 * empty object when the amount is zero (or can't be expressed in `denoms`).
 */
export function centavosToBreakdown(
  amount: number,
  denoms: number[],
): CashBreakdown {
  if (amount <= 0) return {};
  const sorted = [...denoms].sort((a, b) => b - a);
  const out: CashBreakdown = {};
  let rem = amount;
  for (const d of sorted) {
    if (d <= 0) continue;
    if (rem >= d) {
      const count = Math.floor(rem / d);
      out[String(d)] = count;
      rem -= count * d;
    }
    if (rem === 0) break;
  }
  return rem === 0 ? out : {};
}

/** True when no denomination has been counted. */
export function isBreakdownEmpty(breakdown: CashBreakdown): boolean {
  for (const count of Object.values(breakdown)) {
    if (Number(count) > 0) return false;
  }
  return true;
}

/**
 * Strip denominations the operator never sees in practice (e.g. the MXN
 * $0.50 coin Daniel asked to hide by default). Pure transformation — caller
 * picks the threshold. Returns a new array; never mutates input.
 */
export function visibleDenominations(
  denoms: number[],
  minCentavos: number,
): number[] {
  return denoms.filter((d) => d >= minCentavos);
}

/**
 * Format a centavos amount for display in the active currency. Uses
 * Intl.NumberFormat so the symbol/precision are correct for both MXN and
 * USD without us having to keep our own table.
 */
export function formatCurrencyAmount(
  centavos: number,
  currency: string,
  locale = 'en-US',
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(centavos / 100);
  } catch {
    // Unknown currency fallback — render plain number.
    return (centavos / 100).toFixed(2);
  }
}

/**
 * Decide whether a denomination is paper or coin for layout purposes. Wraps
 * the backend `smallestBillCentavos` table — kept inline so the terminal
 * doesn't import from the backend tree (separate vite project).
 */
export function smallestBillCentavos(currency: string): number {
  switch (currency) {
    case 'USD':
      return 100;
    case 'MXN':
    default:
      return 2_000;
  }
}

/** Denomination tables used when the operator wants to count by denom. */
export const TERMINAL_DENOMINATIONS: Record<string, number[]> = {
  MXN: [
    100_000, 50_000, 20_000, 10_000, 5_000, 2_000, // bills $1000–$20
    1_000, 500, 200, 100, 50,                       // coins $10–$0.50
  ],
  USD: [
    10_000, 5_000, 2_000, 1_000, 500, 100,          // bills $100–$1
    25, 10, 5, 1,                                    // coins
  ],
};

export function getTerminalDenominations(currency: string): number[] {
  return TERMINAL_DENOMINATIONS[currency] ?? TERMINAL_DENOMINATIONS.MXN!;
}
