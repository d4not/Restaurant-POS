import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';
import { login } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuthStore } from '../store/auth';
import type { User } from '../types/api';
import { useTranslation } from '../i18n';

const IS_DEV = import.meta.env.DEV;

// Fake session used by the dev-only bypass button. The token is not a real JWT
// and will 401 against a live backend — it only exists so we can explore the UI
// before the /auth/login endpoint ships (backend Phase 6).
const DEV_USER: User = {
  id: 'dev-admin',
  name: 'Administrator (dev)',
  email: 'admin@dev.local',
  role: 'ADMIN',
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const DEV_TOKEN = 'dev-local-bypass';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Already signed in? Kick back to the previous (or home) route.
  if (token) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await login({ email: email.trim(), password });
      setSession(res.token, res.user);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('auth.invalidCredentials');
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">R</div>
          <h1>{t('nav.brand')}</h1>
          <div className="tag">{t('auth.adminPanel')}</div>
        </div>

        {error && <div className="auth-alert">{error}</div>}

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={loading}
            />
          </div>
          <div className="field">
            <label htmlFor="password">{t('auth.password')}</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={loading}
            disabled={!email || !password}
          >
            {t('auth.signIn')}
          </Button>
        </form>

        {IS_DEV && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span className="fs-11 text-muted" style={{ letterSpacing: 1, textTransform: 'uppercase' }}>Development only</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <Button
              type="button"
              variant="secondary"
              block
              onClick={() => {
                setSession(DEV_TOKEN, DEV_USER);
                const from = (location.state as { from?: string } | null)?.from ?? '/';
                navigate(from, { replace: true });
              }}
            >
              Continue without backend
            </Button>
          </>
        )}

        <div className="auth-foot">Protected session · Authorized personnel only</div>
      </div>
    </div>
  );
}
