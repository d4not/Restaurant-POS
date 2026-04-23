import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { useToastStore } from '../store/toast';

// 5 minutes matches the spec default. Kept as a module constant so a future
// "configurable timeout" setting has a single spot to read from.
const IDLE_LIMIT_MS = 5 * 60 * 1000;

// Activity events we treat as "user is still here". Keep the list tight so
// we don't spam renders — one listener per event on window is enough to
// reset the clock. `pointerdown` covers mouse + touch + pen.
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
];

/**
 * Auto-lock the terminal after IDLE_LIMIT_MS with no user activity. Clears
 * the session and bounces to /login so the next user (or the same one) has
 * to re-enter their PIN.
 *
 * The backend cash register stays OPEN — register state is server-owned, so
 * re-logging-in via PIN lands the user back in the same shift via the
 * useOpenRegister hook.
 *
 * Only attached while there's an authenticated session; mounting on the app
 * shell keeps it a singleton regardless of which page is active.
 */
export function useIdleLock() {
  const navigate = useNavigate();
  const token = useSessionStore((s) => s.token);
  const logout = useSessionStore((s) => s.logout);
  const pushToast = useToastStore((s) => s.push);

  // Hold the timer id in a ref so the reset closure doesn't have to read
  // state on every event — cheap event handling matters because these fire
  // on every mousemove-like interaction.
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;

    function lock() {
      logout();
      navigate('/login', { replace: true });
      pushToast('Terminal locked — re-enter your PIN', 'info');
    }

    function reset() {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(lock, IDLE_LIMIT_MS);
    }

    // Seed the timer so even a completely idle user eventually locks.
    reset();

    // capture=true so nothing downstream can stop-propagation our way out of
    // the reset (toast autoclose would otherwise keep renewing but a stuck
    // modal wouldn't).
    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, reset, { capture: true, passive: true }),
    );

    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((ev) =>
        window.removeEventListener(ev, reset, { capture: true } as EventListenerOptions),
      );
    };
  }, [token, logout, navigate, pushToast]);
}
