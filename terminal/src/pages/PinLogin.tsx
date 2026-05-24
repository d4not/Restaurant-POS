import { useEffect, useRef, useState } from 'react';
import { ApiError, getApiBase, getServerRoot, setApiBase } from '../api/client';
import { pinLogin } from '../api/auth';
import type { AuthUser, LoginResult } from '../api/auth';
import { useSession } from '../store/session';
import { useHaptics } from '../hooks/useHaptics';
import { IconBackspace } from '../components/Icons';
import { Spinner } from '../components/Spinner';
import {
  defaultServerUrlForPlatform,
  loadServerUrl,
  saveServerUrl,
} from '../store/serverUrl';
import { useTranslation } from '../i18n';
import { ModePicker } from './ModePicker';

// MANAGER+ operators are offered a mode picker after PIN entry; everyone else
// flows straight into the POS view. Keep this in sync with the backend role
// hierarchy in docs/PERMISSIONS.md.
function canPickAdminMode(user: AuthUser): boolean {
  return user.role === 'MANAGER' || user.role === 'ADMIN';
}

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
  serverFooter: {
    marginTop: 22,
    paddingTop: 16,
    borderTop: '1px solid var(--border)',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  serverLabel: {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: 600,
  },
  serverValue: {
    fontSize: 12,
    color: 'var(--text2)',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    wordBreak: 'break-all',
    textAlign: 'center',
    maxWidth: '100%',
  },
  serverButton: {
    marginTop: 4,
    padding: '6px 14px',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text2)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  modalScrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 70,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    width: 460,
    maxWidth: '100%',
    background: 'var(--bg2)',
    borderRadius: 16,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHead: {
    padding: '20px 22px 14px',
    borderBottom: '1px solid var(--border)',
  },
  modalTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
  },
  modalSub: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 6,
    lineHeight: 1.4,
  },
  modalBody: {
    padding: '18px 22px 4px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  modalLabel: {
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  modalInput: {
    height: 46,
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '0 14px',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    width: '100%',
  },
  modalHint: {
    fontSize: 11,
    color: 'var(--text3)',
    fontStyle: 'italic',
  },
  modalActiveLine: {
    fontSize: 11,
    color: 'var(--text3)',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    wordBreak: 'break-all',
  },
  modalActions: {
    padding: '14px 22px 18px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg)',
  },
  modalGhostBtn: {
    padding: '10px 16px',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--text2)',
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  modalGoldBtn: {
    padding: '10px 16px',
    borderRadius: 8,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid rgba(44,36,32,0.08)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  modalPrimaryBtn: {
    padding: '10px 18px',
    borderRadius: 8,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid var(--text1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  modalBanner: {
    margin: '4px 22px 0',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
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
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => getApiBase());
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const signIn = useSession((s) => s.signIn);
  const sessionExpired = useSession((s) => s.sessionExpired);
  const consumeSessionExpired = useSession((s) => s.consumeSessionExpired);
  const haptics = useHaptics();
  // Holds a successful PIN result for MANAGER+ until they choose POS vs Admin
  // mode. We deliberately don't call signIn() yet — that would dismiss this
  // screen and route the user into the no-shift / orders flow.
  const [pendingSession, setPendingSession] = useState<LoginResult | null>(null);
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
    const handle = window.setTimeout(() => setExpiredToast(false), 6000);
    return () => window.clearTimeout(handle);
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
        // MANAGER+ pause on the mode picker; everyone else (waiter, barista,
        // cashier) goes straight into POS mode like before.
        if (canPickAdminMode(res.user)) {
          setPendingSession(res);
        } else {
          signIn(res.token, res.user);
        }
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : t('login.couldNotSignIn');
        haptics.error();
        setError(message);
        setPin('');
        // Failed PIN: allow retry of the same digits if the user wants.
        submittedRef.current = null;
      })
      .finally(() => {
        setBusy(false);
      });
  }, [pin, signIn, haptics, t]);

  // Hardware keyboard support — handy for development and accessibility. The
  // server-config modal owns its own input, so suppress the global handler
  // while it's open or the URL field would steal digits into the PIN dots.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (busy || serverModalOpen) return;
      if (e.key >= '0' && e.key <= '9') {
        setPin((p) => (p.length < PIN_LENGTH ? p + e.key : p));
      } else if (e.key === 'Backspace') {
        setPin((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, serverModalOpen]);

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

  // Lets the operator point this terminal at a different backend without
  // logging in first — needed on Capacitor builds whose default URL was not
  // baked in at build time, and convenient for switching dev/staging hosts.
  // Uses an in-page modal rather than window.prompt() because Android WebView
  // silently drops prompt() calls, leaving the cashier unable to set the URL.
  function openServerModal() {
    setServerModalOpen(true);
  }
  function handleServerSaved(next: string) {
    setApiBase(next);
    setServerUrl(getApiBase());
    setServerModalOpen(false);
    setError(null);
  }

  // Once a MANAGER/ADMIN has entered the right PIN we hand off to the mode
  // picker. ModePicker commits the session (signIn) when the operator picks a
  // mode, which unmounts this component on the next App render.
  if (pendingSession) {
    return <ModePicker token={pendingSession.token} user={pendingSession.user} />;
  }

  return (
    <div style={{ ...styles.root, position: 'relative' }}>
      {expiredToast && (
        <div style={styles.expiredToast} role="alert">
          {t('login.sessionExpiredToast')}
        </div>
      )}
      <div style={styles.card}>
        <div style={styles.brand}>R</div>
        <h1 style={styles.title}>{t('login.welcomeBack')}</h1>
        <p style={styles.sub}>{t('login.pinPrompt')}</p>

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
            {t('login.clear')}
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
            aria-label={t('login.backspace')}
          >
            <IconBackspace style={{ fontSize: 20 }} />
          </button>
        </div>

        {busy && <div style={styles.spinner}>{t('login.signingIn')}</div>}

        <div style={styles.serverFooter}>
          <span style={styles.serverLabel}>{t('login.serverLabel')}</span>
          <span style={styles.serverValue}>{serverUrl || t('login.serverNotConfigured')}</span>
          <button type="button" style={styles.serverButton} onClick={openServerModal}>
            {t('login.changeServer')}
          </button>
        </div>
      </div>
      {serverModalOpen && (
        <ServerConfigModal
          onClose={() => setServerModalOpen(false)}
          onSaved={handleServerSaved}
        />
      )}
    </div>
  );
}

interface ServerConfigModalProps {
  onClose: () => void;
  onSaved: (url: string) => void;
}

// Replaces window.prompt() for setting the backend URL. Lives next to the PIN
// screen because that's the only place the cashier can reach it before signing
// in — once authenticated the same control is in Settings → General.
function ServerConfigModal({ onClose, onSaved }: ServerConfigModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>(() => getApiBase());
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; latencyMs: number } | { ok: false; error: string } | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate the draft from persisted storage on open. If nothing's stored,
  // surface the platform default so the field shows a meaningful starting
  // point on a fresh install (rather than a stale in-memory fallback).
  useEffect(() => {
    let cancelled = false;
    loadServerUrl()
      .then((stored) => {
        if (cancelled) return;
        const fallback = defaultServerUrlForPlatform() || getApiBase();
        setDraft(stored || fallback);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-focus the input once we've hydrated so the on-screen keyboard pops up
  // on tablets without a second tap.
  useEffect(() => {
    if (!hydrated) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [hydrated]);

  // Esc cancels — matches the convention used by the settings/hamburger modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = draft.trim();
  const valid = /^https?:\/\/.+/i.test(trimmed);

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await saveServerUrl(trimmed);
    } catch {
      /* storage unavailable on web preview — still apply for this session */
    }
    onSaved(trimmed);
  }

  async function runTest() {
    if (!valid || testing) return;
    setTesting(true);
    setTestResult(null);
    // Test the *draft* URL, not the live one — operators usually test before
    // committing. Strip /api/v1 the same way getServerRoot does for live.
    const draftRoot = trimmed.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
    const target = `${draftRoot}/health`;
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(target, { signal: controller.signal });
      const latencyMs = Math.round(performance.now() - startedAt);
      if (!res.ok) {
        setTestResult({ ok: false, error: `Server returned ${res.status}` });
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { status?: string } }
        | null;
      if (!body?.success || body.data?.status !== 'ok') {
        setTestResult({ ok: false, error: 'Unexpected health response' });
        return;
      }
      setTestResult({ ok: true, latencyMs });
    } catch (err) {
      const reason =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Timed out after 5s'
          : err instanceof Error
            ? err.message
            : t('settings.couldNotReach');
      setTestResult({ ok: false, error: reason });
    } finally {
      window.clearTimeout(timeout);
      setTesting(false);
    }
  }

  function bannerStyle(ok: boolean): React.CSSProperties {
    return {
      ...styles.modalBanner,
      background: ok ? 'rgba(74,140,92,0.12)' : 'rgba(196,80,64,0.10)',
      color: ok ? 'var(--green)' : 'var(--red)',
    };
  }

  return (
    <div
      style={styles.modalScrim}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('login.serverPromptTitle')}
    >
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header style={styles.modalHead}>
          <h2 style={styles.modalTitle}>{t('login.serverPromptTitle')}</h2>
          <p style={styles.modalSub}>{t('login.serverPromptDesc')}</p>
        </header>
        <div style={styles.modalBody}>
          <label style={styles.modalLabel} htmlFor="server-url-input">
            {t('settings.serverBaseLabel')}
          </label>
          <input
            id="server-url-input"
            ref={inputRef}
            style={styles.modalInput}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setTestResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid && !saving) {
                e.preventDefault();
                void save();
              }
            }}
            placeholder="http://192.168.1.100:3000/api/v1"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
            type="url"
          />
          <div style={styles.modalHint}>{t('login.serverPromptHint')}</div>
          <div style={styles.modalActiveLine}>
            {t('settings.activeUrl')}: {getServerRoot() || '—'}
          </div>
        </div>
        {!valid && draft.length > 0 && (
          <div style={bannerStyle(false)}>{t('settings.urlMustStart')}</div>
        )}
        {testResult?.ok && (
          <div style={bannerStyle(true)}>
            {t('settings.connectedHealth')} {testResult.latencyMs}ms.
          </div>
        )}
        {testResult && !testResult.ok && (
          <div style={bannerStyle(false)}>
            {t('settings.couldNotReach')}: {testResult.error}
          </div>
        )}
        <div style={styles.modalActions}>
          <button type="button" style={styles.modalGhostBtn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={{
              ...styles.modalGoldBtn,
              opacity: !valid || testing ? 0.55 : 1,
              cursor: !valid || testing ? 'not-allowed' : 'pointer',
            }}
            onClick={runTest}
            disabled={!valid || testing}
          >
            {testing ? <Spinner size={12} /> : null}
            {t('settings.testConnection')}
          </button>
          <button
            type="button"
            style={{
              ...styles.modalPrimaryBtn,
              opacity: !valid || saving ? 0.55 : 1,
              cursor: !valid || saving ? 'not-allowed' : 'pointer',
            }}
            onClick={save}
            disabled={!valid || saving}
          >
            {t('settings.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}
