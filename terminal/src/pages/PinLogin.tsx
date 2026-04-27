import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { pinLogin } from '../api/auth';
import { useSession } from '../store/session';
import { useHaptics } from '../hooks/useHaptics';
import { IconBackspace } from '../components/Icons';

const PIN_LENGTH = 4;

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    background: 'var(--bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: 420,
    maxWidth: '100%',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 18,
    boxShadow: 'var(--shadow-lg)',
    padding: '36px 32px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  brand: {
    width: 64,
    height: 64,
    borderRadius: 14,
    background: 'linear-gradient(135deg, #c9a45c 0%, #a8843f 100%)',
    color: '#2c2420',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Playfair Display', serif",
    fontSize: 30,
    fontWeight: 700,
    marginBottom: 18,
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 26,
    fontWeight: 600,
    color: 'var(--text1)',
    marginBottom: 4,
  },
  sub: {
    fontSize: 13,
    color: 'var(--text2)',
    marginBottom: 28,
  },
  dots: {
    display: 'flex',
    gap: 14,
    marginBottom: 12,
  },
  error: {
    fontSize: 12,
    color: 'var(--red)',
    minHeight: 18,
    marginBottom: 14,
    fontWeight: 500,
    letterSpacing: '0.02em',
    textAlign: 'center',
  },
  pad: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    width: '100%',
    maxWidth: 320,
  },
  key: {
    height: 68,
    borderRadius: 12,
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    fontFamily: "'Playfair Display', serif",
    fontSize: 26,
    fontWeight: 600,
    color: 'var(--text1)',
    cursor: 'pointer',
    transition: 'all 0.1s',
  },
  keyAction: {
    height: 68,
    borderRadius: 12,
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--text2)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    transition: 'all 0.1s',
  },
  spinner: {
    fontSize: 12,
    color: 'var(--text3)',
    marginTop: 14,
    letterSpacing: '0.04em',
  },
  expiredToast: {
    position: 'absolute',
    top: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 18px',
    borderRadius: 10,
    background: 'rgba(196,80,64,0.92)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    letterSpacing: '0.02em',
  },
};

const dotStyle = (filled: boolean): React.CSSProperties => ({
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: filled ? 'var(--text1)' : 'transparent',
  border: `2px solid ${filled ? 'var(--text1)' : 'var(--border)'}`,
  transition: 'all 0.15s',
});

export function PinLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signIn = useSession((s) => s.signIn);
  const sessionExpired = useSession((s) => s.sessionExpired);
  const consumeSessionExpired = useSession((s) => s.consumeSessionExpired);
  const haptics = useHaptics();
  // Tracks which PIN we've already attempted, so StrictMode's double-invoke of
  // useEffect (and the busy state update that re-runs the effect) doesn't
  // cancel the in-flight request before signIn fires. A ref survives the
  // re-runs without triggering one.
  const submittedRef = useRef<string | null>(null);
  // Show "Session expired" toast for ~6 seconds when arrival was triggered by
  // a 401, then auto-clear. Reading the flag also clears it so a screen-lock
  // followed by a manual unlock doesn't replay an old expiry message.
  const [expiredToast, setExpiredToast] = useState(false);
  useEffect(() => {
    if (!sessionExpired) return;
    setExpiredToast(true);
    consumeSessionExpired();
    const t = window.setTimeout(() => setExpiredToast(false), 6000);
    return () => window.clearTimeout(t);
  }, [sessionExpired, consumeSessionExpired]);

  // Submit as soon as the user has entered the full PIN. The PIN length is
  // fixed for now (4 digits is what the seed data uses); when 6-digit pins
  // land we can detect length on first wrong attempt and prompt accordingly.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;
    if (submittedRef.current === pin) return;
    submittedRef.current = pin;

    setBusy(true);
    setError(null);
    pinLogin(pin)
      .then((res) => {
        haptics.success();
        signIn(res.token, res.user);
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : 'Could not sign in';
        haptics.error();
        setError(message);
        setPin('');
        // Failed PIN: allow retry of the same digits if the user wants.
        submittedRef.current = null;
      })
      .finally(() => {
        setBusy(false);
      });
  }, [pin, signIn, haptics]);

  // Hardware keyboard support — handy for development and accessibility.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key >= '0' && e.key <= '9') {
        setPin((p) => (p.length < PIN_LENGTH ? p + e.key : p));
      } else if (e.key === 'Backspace') {
        setPin((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy]);

  function press(digit: string) {
    if (busy) return;
    haptics.tap();
    setError(null);
    setPin((p) => (p.length < PIN_LENGTH ? p + digit : p));
  }

  function backspace() {
    if (busy) return;
    haptics.tap();
    setPin((p) => p.slice(0, -1));
  }

  function clearAll() {
    if (busy) return;
    haptics.tap();
    setPin('');
    setError(null);
  }

  return (
    <div style={{ ...styles.root, position: 'relative' }}>
      {expiredToast && (
        <div style={styles.expiredToast} role="alert">
          Session expired. Please sign in again.
        </div>
      )}
      <div style={styles.card}>
        <div style={styles.brand}>R</div>
        <h1 style={styles.title}>Welcome back</h1>
        <p style={styles.sub}>Enter your PIN to continue</p>

        <div style={styles.dots}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div key={i} style={dotStyle(i < pin.length)} />
          ))}
        </div>

        <div style={styles.error}>{error ?? ' '}</div>

        <div className="pin-keypad" style={styles.pad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              style={styles.key}
              onClick={() => press(d)}
              disabled={busy}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            style={styles.keyAction}
            onClick={clearAll}
            disabled={busy}
          >
            Clear
          </button>
          <button
            type="button"
            style={styles.key}
            onClick={() => press('0')}
            disabled={busy}
          >
            0
          </button>
          <button
            type="button"
            style={styles.keyAction}
            onClick={backspace}
            disabled={busy}
            aria-label="Backspace"
          >
            <IconBackspace style={{ fontSize: 20 }} />
          </button>
        </div>

        {busy && <div style={styles.spinner}>Signing in…</div>}
      </div>
    </div>
  );
}
