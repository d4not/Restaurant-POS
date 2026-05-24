// Lightweight health probe for the Electron printer service. Polls the
// resolver on a 30s cadence and reduces the per-role recommendations into a
// single "are we OK?" signal for the topbar banner.
//
// Behaviour notes worth knowing:
//
// • Web sessions (no window.electron) are treated as healthy. The backend
//   printer is monitored separately by the PrinterCheckPanel and shouldn't
//   spam a banner — mobile cashiers configure printers via admin, not here.
//
// • A role is "unhealthy" only when the resolver wants the operator to do
//   something: switch printers, investigate a broken one, fix permissions.
//   `pick-primary` (no saved address) and `no-printer-available` (no printer
//   plugged in at all) are tolerated silently — the operator may not have
//   wired up that role yet, and a banner shouting at them on every shift
//   start would be noise.
//
// • Debounce: a fresh failure shows up only after a second consecutive
//   unhealthy poll, to avoid flicker during transient network blips or while
//   the OS reattaches a USB device. Recovery is immediate (one healthy poll
//   clears the banner) because the operator probably just fixed it.

import { useEffect, useRef, useState } from 'react';

export type PrinterHealthState =
  | { kind: 'unknown' }
  | { kind: 'unavailable' } // not running in Electron, monitor disabled
  | { kind: 'healthy'; checkedAt: number }
  | {
      kind: 'unhealthy';
      checkedAt: number;
      issues: Array<{ role: PrinterRole; recommendation: PrinterRecommendation; reasoning: string; primaryLabel: string | null }>;
    };

const POLL_INTERVAL_MS = 30_000;

// Recommendations that the banner should react to. Other values silence the
// monitor for that role.
const ALARM_RECOMMENDATIONS: ReadonlySet<PrinterRecommendation> = new Set([
  'investigate-current',
  'switch-primary',
  'permission-issue',
]);

function isUnhealthyRole(roleData: PrinterResolveRoleResult): boolean {
  const { plan, currentConfig } = roleData;
  if (!currentConfig.enabled) return false; // role disabled = operator opted out
  if (!ALARM_RECOMMENDATIONS.has(plan.recommendation)) return false;
  return true;
}

export function usePrinterHealth(): PrinterHealthState {
  const [state, setState] = useState<PrinterHealthState>({ kind: 'unknown' });
  // Sticky counter — we only flip to unhealthy after two consecutive failed
  // polls so a 1-second WiFi blip doesn't pop the banner.
  const consecutiveBadRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (typeof window === 'undefined' || !window.electron?.printer?.resolve) {
      setState({ kind: 'unavailable' });
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelledRef.current) return;
      try {
        const result = await window.electron!.printer.resolve();
        const issues: Array<{
          role: PrinterRole;
          recommendation: PrinterRecommendation;
          reasoning: string;
          primaryLabel: string | null;
        }> = [];
        for (const role of ['receipt', 'kitchen'] as const) {
          if (isUnhealthyRole(result[role])) {
            issues.push({
              role,
              recommendation: result[role].plan.recommendation,
              reasoning: result[role].plan.reasoning,
              primaryLabel: result[role].plan.primary?.label ?? null,
            });
          }
        }
        const now = Date.now();
        if (issues.length > 0) {
          consecutiveBadRef.current += 1;
          if (consecutiveBadRef.current >= 2) {
            setState({ kind: 'unhealthy', checkedAt: now, issues });
          } else {
            // First bad poll — still report as healthy to debounce. If the next
            // poll is also bad we flip; if it recovers, we stay clean.
            setState((prev) => (prev.kind === 'unhealthy' ? prev : { kind: 'healthy', checkedAt: now }));
          }
        } else {
          consecutiveBadRef.current = 0;
          setState({ kind: 'healthy', checkedAt: now });
        }
      } catch {
        // Probe itself failed (IPC error, no window). Don't flip to unhealthy
        // for that — the issue is the monitor, not the printer.
        setState((prev) => (prev.kind === 'unknown' ? { kind: 'unavailable' } : prev));
      } finally {
        if (!cancelledRef.current) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      }
    };

    // First tick runs immediately so the banner can settle before the
    // operator notices a stale "unknown" state.
    tick();
    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}
