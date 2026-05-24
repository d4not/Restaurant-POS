/**
 * Local-state hook for the CashCounter component. CashCounter itself is
 * controlled (parent passes `value`/`onChange`) so that a real close flow can
 * own the breakdown alongside the rest of its form state — but most callers
 * (demos, blind-count overlays, the simple denomination chooser) just want a
 * useState-ish API. This hook is that.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  breakdownToCentavos,
  centavosToBreakdown,
  getTerminalDenominations,
  visibleDenominations,
  type CashBreakdown,
} from '../utils/cashCount';

export interface UseCashCounterOptions {
  currency: string;
  initialBreakdown?: CashBreakdown;
  /** Strip the smallest coins (e.g. MXN $0.50) — Daniel asked these stay off
   *  the default UI because the operator never sees them in real life. */
  hideSubunits?: boolean;
  /** Minimum centavos to keep when `hideSubunits` is true. Defaults: MXN→100,
   *  USD→100 (i.e. coins < $1 hidden). Override if a region uses different
   *  cutoffs. */
  subunitFloor?: number;
}

export interface UseCashCounterResult {
  breakdown: CashBreakdown;
  denoms: number[];
  total: number;
  setCount: (denom: number, count: number) => void;
  increment: (denom: number, step?: number) => void;
  decrement: (denom: number, step?: number) => void;
  reset: () => void;
  applyBreakdown: (next: CashBreakdown) => void;
  /** Greedy-fill the breakdown from a target total. Useful for "the expected
   *  amount is $1,234 — preload the most likely composition". */
  suggestFromTotal: (centavos: number) => void;
}

export function useCashCounter(
  opts: UseCashCounterOptions,
): UseCashCounterResult {
  const [breakdown, setBreakdown] = useState<CashBreakdown>(
    opts.initialBreakdown ?? {},
  );

  const denoms = useMemo(() => {
    const all = getTerminalDenominations(opts.currency);
    if (!opts.hideSubunits) return all;
    const floor = opts.subunitFloor ?? 100;
    return visibleDenominations(all, floor);
  }, [opts.currency, opts.hideSubunits, opts.subunitFloor]);

  const total = useMemo(() => breakdownToCentavos(breakdown), [breakdown]);

  const setCount = useCallback((denom: number, count: number) => {
    setBreakdown((prev) => {
      const next = { ...prev };
      const safeCount = Math.max(0, Math.floor(count));
      if (safeCount === 0) delete next[String(denom)];
      else next[String(denom)] = safeCount;
      return next;
    });
  }, []);

  const increment = useCallback(
    (denom: number, step: number = 1) => {
      setBreakdown((prev) => {
        const current = Number(prev[String(denom)] ?? 0);
        return { ...prev, [String(denom)]: current + Math.max(1, step) };
      });
    },
    [],
  );

  const decrement = useCallback(
    (denom: number, step: number = 1) => {
      setBreakdown((prev) => {
        const current = Number(prev[String(denom)] ?? 0);
        const nextCount = Math.max(0, current - Math.max(1, step));
        const next = { ...prev };
        if (nextCount === 0) delete next[String(denom)];
        else next[String(denom)] = nextCount;
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => setBreakdown({}), []);

  const applyBreakdown = useCallback((next: CashBreakdown) => {
    setBreakdown({ ...next });
  }, []);

  const suggestFromTotal = useCallback(
    (centavos: number) => {
      setBreakdown(centavosToBreakdown(centavos, denoms));
    },
    [denoms],
  );

  return {
    breakdown,
    denoms,
    total,
    setCount,
    increment,
    decrement,
    reset,
    applyBreakdown,
    suggestFromTotal,
  };
}
