import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Numpad } from '../components/ui/Numpad';
import { pinLogin } from '../api/auth';
import { ApiError } from '../api/client';
import { defaultPathForRole, useSessionStore } from '../store/session';

const PIN_MIN = 4;
const PIN_MAX = 6;

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  // Hardware keypad fallback — most café terminals are touch-only, but a
  // dev typing on a laptop appreciates this.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') {
        appendDigit(event.key);
      } else if (event.key === 'Backspace') {
        backspace();
      } else if (event.key === 'Enter') {
        void submit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, submitting]);

  function appendDigit(d: string) {
    if (submitting) return;
    setError(null);
    setPin((prev) => (prev.length >= PIN_MAX ? prev : prev + d));
  }

  function backspace() {
    if (submitting) return;
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }

  function clear() {
    if (submitting) return;
    setError(null);
    setPin('');
  }

  async function submit() {
    if (submitting) return;
    if (pin.length < PIN_MIN) {
      setError(`PIN must be at least ${PIN_MIN} digits`);
      flashError();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await pinLogin(pin);
      setSession(result.token, result.user);
      navigate(defaultPathForRole(result.user.role), { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not reach the server';
      setError(message);
      setPin('');
      flashError();
    } finally {
      setSubmitting(false);
    }
  }

  function flashError() {
    setShake(true);
    window.setTimeout(() => setShake(false), 360);
  }

  // Auto-submit once the PIN reaches the maximum length — saves a tap on the
  // 6-digit case where it's obvious the user is done.
  useEffect(() => {
    if (pin.length === PIN_MAX && !submitting) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // Render PIN_MAX dot slots so the layout doesn't shift as the user types.
  const dots = Array.from({ length: PIN_MAX }, (_, idx) => (
    <span
      key={idx}
      className={`pin-dot ${idx < pin.length ? 'filled' : ''} ${shake ? 'error' : ''}`}
    />
  ));

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="logo">Restaurant POS</div>
        <div className="subtitle">Terminal · Enter your PIN</div>

        <div className="pin-display">{dots}</div>

        <div className="login-error">{error ?? ' '}</div>

        <Numpad
          onDigit={appendDigit}
          onClear={clear}
          onBackspace={backspace}
          disabled={submitting}
        />

        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => { void submit(); }}
          disabled={submitting || pin.length < PIN_MIN}
        >
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}
