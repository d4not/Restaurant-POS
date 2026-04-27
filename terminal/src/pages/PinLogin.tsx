import { useEffect, useRef, useState } from 'react';
import { ApiError, getApiBase, setApiBase } from '../api/client';
import { pinLogin } from '../api/auth';
import { useSession } from '../store/session';
import { useHaptics } from '../hooks/useHaptics';
import { IconBackspace, IconClose } from '../components/Icons';
import {
  defaultServerUrlForPlatform,
  saveServerUrl,
} from '../store/serverUrl';
import { useTranslation } from '../i18n';

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
    background: 'rgba(44,36,32,0.45)',
    zIndex: 95,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    width: 460,
    maxWidth: '100%',
    background: 'var(--bg2)',
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHead: {
    padding: '20px 22px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  modalTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
    lineHeight: 1.2,
  },
  modalSub: {
    fontSize: 13,
    color: 'var(--text2)',
    marginTop: 4,
    lineHeight: 1.45,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    wordBreak: 'break-all',
  },
  modalCloseBtn: {
    marginLeft: 'auto',
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 14,
    flexShrink: 0,
  },
  modalBody: { padding: '18px 22px' },
  modalInput: {
    width: '100%',
    height: 48,
    padding: '0 14px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 14,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    outline: 'none',
  },
  modalActions: {
    padding: '14px 22px 18px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
    background: 'var(--bg)',
  },
  modalCancel: {
    padding: '12px 18px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 46,
    minWidth: 100,
  },
};

const modalSaveStyle = (enabled: boolean): React.CSSProperties => ({
  padding: '12px 18px',
  borderRadius: 8,
  background: enabled ? 'var(--text1)' : 'rgba(44,36,32,0.35)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid ' + (enabled ? 'var(--text1)' : 'rgba(44,36,32,0.35)'),
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontFamily: 'inherit',
  minHeight: 46,
  minWidth: 110,
});

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
  // Modal state for the in-app server URL editor. Replaces window.prompt(),
  // which is disabled in Electron (>=v7) and unreliable in Capacitor's Android
  // WebView — both used to silently no-op and leave the URL unchanged.
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [serverDraft, setServerDraft] = useState('');
  const [serverSaving, setServerSaving] = useState(false);
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
        signIn(res.token, res.user);
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

  // Lets the operator point this terminal at a different backend without
  // logging in first — needed on Capacitor builds whose default URL was not
  // baked in at build time, and convenient for switching dev/staging hosts.
  function openServerModal() {
    setServerDraft(getApiBase());
    setServerModalOpen(true);
  }

  async function saveServer() {
    const trimmed = serverDraft.trim();
    if (!trimmed) return;
    setServerSaving(true);
    try {
      try {
        await saveServerUrl(trimmed);
      } catch {
        /* storage unavailable on web preview — still apply for this session */
      }
      setApiBase(trimmed);
      setServerUrl(getApiBase());
      setError(null);
      setServerModalOpen(false);
    } finally {
      setServerSaving(false);
    }
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
        <div
          style={styles.modalScrim}
          onClick={() => {
            if (!serverSaving) setServerModalOpen(false);
          }}
        >
          <div
            style={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div style={styles.modalHead}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={styles.modalTitle}>{t('login.serverPromptTitle')}</h2>
                <div style={styles.modalSub}>
                  {t('login.serverPromptExample')}:{' '}
                  {defaultServerUrlForPlatform() || 'http://192.168.1.100:3000/api/v1'}
                </div>
              </div>
              <button
                type="button"
                style={styles.modalCloseBtn}
                onClick={() => setServerModalOpen(false)}
                disabled={serverSaving}
                aria-label={t('common.close')}
              >
                <IconClose style={{ fontSize: 14 }} />
              </button>
            </div>

            <div style={styles.modalBody}>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={serverDraft}
                onChange={(e) => setServerDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && serverDraft.trim() && !serverSaving) {
                    e.preventDefault();
                    void saveServer();
                  } else if (e.key === 'Escape' && !serverSaving) {
                    setServerModalOpen(false);
                  }
                }}
                placeholder="http://192.168.1.100:3000/api/v1"
                style={styles.modalInput}
                autoFocus
              />
            </div>

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancel}
                onClick={() => setServerModalOpen(false)}
                disabled={serverSaving}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                style={modalSaveStyle(serverDraft.trim().length > 0 && !serverSaving)}
                onClick={() => void saveServer()}
                disabled={!serverDraft.trim() || serverSaving}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
