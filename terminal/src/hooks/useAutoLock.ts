import { useEffect, useRef } from 'react';
import { useSession } from '../store/session';
import { usePreferences } from '../store/preferences';

// Idle activity events. We only listen on `mousedown` / `keydown` / `touchstart`
// (and `wheel` for trackpads) — pointermove would reset the timer constantly
// and defeat the purpose, since a cleaning cloth on a touchscreen would count
// as "use".
const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  'mousedown',
  'keydown',
  'touchstart',
  'wheel',
];

/**
 * Auto-lock the terminal after N minutes of inactivity. Reads `idleLockMinutes`
 * from preferences and `lock()` from the session store. Setting minutes to 0
 * disables the timer entirely. The session token is preserved — the cashier
 * just re-enters their PIN to resume, and the cash register stays open.
 *
 * Should be mounted exactly once, near the root, and only while the user is
 * authenticated (we drive that check from App.tsx).
 */
export function useAutoLock(active: boolean): void {
  const idleMinutes = usePreferences((s) => s.idleLockMinutes);
  const lock = useSession((s) => s.lock);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || idleMinutes <= 0) return;

    const idleMs = idleMinutes * 60_000;

    function clearTimer() {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function scheduleLock() {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        // Re-read locked at fire time — if the user already locked manually we
        // don't want to "re-lock" and trample any future state changes.
        if (!useSession.getState().locked) {
          lock();
        }
      }, idleMs);
    }

    function onActivity() {
      // Don't reset once locked; the activity that wakes the screen is the PIN
      // entry itself, which clears `locked` via signIn().
      if (useSession.getState().locked) return;
      scheduleLock();
    }

    scheduleLock();
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, onActivity, { passive: true });
    }

    return () => {
      clearTimer();
      for (const evt of ACTIVITY_EVENTS) {
        document.removeEventListener(evt, onActivity);
      }
    };
  }, [active, idleMinutes, lock]);
}
