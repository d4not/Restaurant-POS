import { useEffect, useRef, useState } from 'react';
import { IconBackspace, IconClose, IconShield } from './Icons';
import { Spinner } from './Spinner';
import { useTranslation } from '../i18n';

const REASON_MIN_LENGTH = 5;
const PIN_LENGTH = 4;

interface CancelOrderModalProps {
  tableLabel: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string, pin: string) => void;
}

const pinDotStyle = (filled: boolean): React.CSSProperties => ({
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
  background: enabled ? 'var(--red)' : 'rgba(196,80,64,0.45)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid ' + (enabled ? 'var(--red)' : 'rgba(196,80,64,0.45)'),
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
    zIndex: 90,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    width: 480,
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
    padding: '20px 24px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: 'rgba(196,80,64,0.14)',
    color: 'var(--red)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 20,
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
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
    width: 32,
    height: 32,
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
  body: {
    padding: '20px 24px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
    marginBottom: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  reasonInput: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 80,
    outline: 'none',
    lineHeight: 1.45,
  },
  reasonHint: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 6,
    display: 'flex',
    justifyContent: 'space-between',
  },
  pinDots: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 12,
  },
  numpad: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
  },
  numKey: {
    height: 56,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.12s',
  },
  numKeyMuted: {
    height: 56,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text2)',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errBanner: {
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
    minWidth: 110,
  },
};

export function CancelOrderModal({
  tableLabel,
  busy,
  error,
  onClose,
  onConfirm,
}: CancelOrderModalProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => reasonRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const reasonClean = reason.trim();
  const reasonValid = reasonClean.length >= REASON_MIN_LENGTH;
  const pinValid = pin.length >= PIN_LENGTH;
  const canSubmit = reasonValid && pinValid && !busy;

  function pressKey(digit: string) {
    if (busy) return;
    setPin((current) => (current.length >= 6 ? current : current + digit));
  }
  function pressBackspace() {
    if (busy) return;
    setPin((current) => current.slice(0, -1));
  }

  function submit() {
    if (!canSubmit) return;
    onConfirm(reasonClean, pin);
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
            <h2 style={styles.title}>{t('orders.cancelTitle')} {tableLabel}</h2>
            <div style={styles.sub}>{t('cancel.subDescription')}</div>
          </div>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            disabled={busy}
            aria-label={t('common.close')}
          >
            <IconClose style={{ fontSize: 16 }} />
          </button>
        </div>

        <div style={styles.body}>
          <div>
            <div style={styles.fieldLabel}>{t('cancel.reasonField')}</div>
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('cancel.reasonInputPh')}
              style={styles.reasonInput}
              maxLength={500}
              disabled={busy}
            />
            <div style={styles.reasonHint}>
              <span style={{ color: reasonValid ? 'var(--green)' : 'var(--text3)' }}>
                {reasonValid
                  ? t('cancel.lengthOk')
                  : t('cancel.lengthMin').replace('{n}', String(REASON_MIN_LENGTH))}
              </span>
              <span>{reasonClean.length}/500</span>
            </div>
          </div>

          <div>
            <div style={styles.fieldLabel}>
              <IconShield style={{ fontSize: 14 }} />
              {t('cancel.confirmPin')}
            </div>
            <div style={styles.pinDots}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={pinDotStyle(i < pin.length)} />
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
        </div>

        <div style={styles.actions}>
          <button
            type="button"
            style={styles.cancelBtn}
            onClick={onClose}
            disabled={busy}
          >
            {t('cancel.keepOrder')}
          </button>
          <button
            type="button"
            style={confirmBtnStyle(canSubmit)}
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? <Spinner size={14} /> : <IconClose style={{ fontSize: 16 }} />}
            {t('cancel.confirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
