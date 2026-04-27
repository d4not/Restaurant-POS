import { useEffect, useState } from 'react';
import { IconBackspace, IconClose, IconShield } from './Icons';
import { Spinner } from './Spinner';
import { useTranslation } from '../i18n';

const PIN_MIN_LENGTH = 4;

interface PinConfirmModalProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (pin: string) => void;
}

const dotStyle = (filled: boolean): React.CSSProperties => ({
  width: 14,
  height: 14,
  borderRadius: '50%',
  background: filled ? 'var(--text1)' : 'transparent',
  border: '1.5px solid ' + (filled ? 'var(--text1)' : 'var(--border)'),
  transition: 'all 0.12s',
});

const confirmBtnStyle = (enabled: boolean): React.CSSProperties => ({
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
  minWidth: 130,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
});

const styles: Record<string, React.CSSProperties> = {
  scrim: {
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
    width: 420,
    maxWidth: '100%',
    background: 'var(--bg2)',
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '92vh',
  },
  head: {
    padding: '20px 22px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: 'rgba(201,164,92,0.16)',
    color: 'var(--gold)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 20,
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
    lineHeight: 1.2,
  },
  sub: {
    fontSize: 13,
    color: 'var(--text2)',
    marginTop: 4,
    lineHeight: 1.45,
  },
  closeBtn: {
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
  body: { padding: '18px 22px 4px', overflowY: 'auto' },
  pinDots: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    margin: '8px 0 14px',
  },
  numpad: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
    padding: '0 4px 14px',
  },
  numKey: {
    height: 54,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    cursor: 'pointer',
  },
  numKeyMuted: {
    height: 54,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text2)',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errBanner: {
    margin: '0 22px 14px',
    padding: '10px 12px',
    borderRadius: 8,
    background: 'rgba(196,80,64,0.10)',
    border: '1px solid rgba(196,80,64,0.35)',
    color: 'var(--red)',
    fontSize: 13,
    lineHeight: 1.4,
  },
  actions: {
    padding: '14px 22px 18px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
    background: 'var(--bg)',
  },
  cancelBtn: {
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

export function PinConfirmModal({
  title,
  message,
  confirmLabel,
  busy,
  error,
  onClose,
  onConfirm,
}: PinConfirmModalProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const resolvedConfirmLabel = confirmLabel ?? t('common.confirm');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onClose();
      } else if (e.key === 'Enter' && pin.length >= PIN_MIN_LENGTH && !busy) {
        e.preventDefault();
        onConfirm(pin);
      } else if (/^\d$/.test(e.key) && pin.length < 6 && !busy) {
        setPin((p) => p + e.key);
      } else if (e.key === 'Backspace' && !busy) {
        setPin((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, onConfirm, pin]);

  const canSubmit = pin.length >= PIN_MIN_LENGTH && !busy;

  function pressKey(d: string) {
    if (busy) return;
    setPin((p) => (p.length >= 6 ? p : p + d));
  }
  function pressBackspace() {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
  }

  return (
    <div
      style={styles.scrim}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={styles.head}>
          <div style={styles.headIcon}>
            <IconShield style={{ fontSize: 20 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={styles.title}>{title}</h2>
            {message && <div style={styles.sub}>{message}</div>}
          </div>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            disabled={busy}
            aria-label={t('common.close')}
          >
            <IconClose style={{ fontSize: 14 }} />
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.pinDots}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={dotStyle(i < pin.length)} />
            ))}
          </div>
          <div style={styles.numpad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                style={styles.numKey}
                onClick={() => pressKey(d)}
                disabled={busy}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              style={styles.numKeyMuted}
              onClick={() => setPin('')}
              disabled={busy}
            >
              {t('login.clear')}
            </button>
            <button
              type="button"
              style={styles.numKey}
              onClick={() => pressKey('0')}
              disabled={busy}
            >
              0
            </button>
            <button
              type="button"
              style={styles.numKeyMuted}
              onClick={pressBackspace}
              disabled={busy}
              aria-label={t('login.backspace')}
            >
              <IconBackspace style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        {error && <div style={styles.errBanner}>{error}</div>}

        <div style={styles.actions}>
          <button
            type="button"
            style={styles.cancelBtn}
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={confirmBtnStyle(canSubmit)}
            onClick={() => canSubmit && onConfirm(pin)}
            disabled={!canSubmit}
          >
            {busy ? <Spinner size={14} /> : <IconShield style={{ fontSize: 16 }} />}
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
