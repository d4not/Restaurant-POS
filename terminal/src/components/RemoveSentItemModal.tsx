import { useEffect, useState } from 'react';
import { IconBackspace, IconClose, IconShield } from './Icons';
import { Spinner } from './Spinner';
import { useTranslation } from '../i18n';
import type { VoidReasonCode } from '../api/orders';

const REASON_MIN_LENGTH = 3;
const PIN_MIN_LENGTH = 4;

interface RemoveSentItemModalProps {
  itemName: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (input: {
    reasonCode: VoidReasonCode;
    // Trimmed free-text comment. Undefined when the cashier left the box
    // empty on a non-OTHER reason (the textarea is optional in that case).
    reason: string | undefined;
    pin: string;
  }) => void;
}

// Order matters — buttons render in this sequence. BEFORE_PREP is flagged
// "no merma" so the cashier can pick it knowing the kitchen hadn't started.
const REASON_OPTIONS: ReadonlyArray<{
  code: VoidReasonCode;
  labelKey: string;
  helperKey?: string;
}> = [
  { code: 'PRODUCT_CHANGE', labelKey: 'remove.reason.change' },
  { code: 'PRODUCT_DEFECT', labelKey: 'remove.reason.defect' },
  { code: 'BEFORE_PREP',    labelKey: 'remove.reason.beforePrep', helperKey: 'remove.reason.beforePrepHelper' },
  { code: 'OTHER',          labelKey: 'remove.reason.other' },
];

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
  minWidth: 140,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
});

const reasonBtnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'rgba(44,36,32,0.05)' : 'var(--bg)',
  color: 'var(--text1)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  minHeight: 56,
  transition: 'all 0.12s',
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
    width: 520,
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
  optionalTag: {
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 500,
    marginLeft: 'auto',
  },
  reasonGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  reasonLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
    lineHeight: 1.25,
  },
  reasonHelper: {
    fontSize: 11,
    color: 'var(--text3)',
    lineHeight: 1.35,
  },
  reasonHelperGreen: {
    fontSize: 11,
    color: 'var(--green)',
    fontWeight: 600,
    lineHeight: 1.35,
  },
  commentInput: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 76,
    outline: 'none',
    lineHeight: 1.45,
  },
  commentHint: {
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
    height: 50,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.12s',
  },
  numKeyMuted: {
    height: 50,
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

export function RemoveSentItemModal({
  itemName,
  busy,
  error,
  onClose,
  onConfirm,
}: RemoveSentItemModalProps) {
  const { t } = useTranslation();
  const [reasonCode, setReasonCode] = useState<VoidReasonCode | null>(null);
  const [comment, setComment] = useState('');
  const [pin, setPin] = useState('');

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

  const commentClean = comment.trim();
  // Free text is only required for OTHER — the three named codes speak for
  // themselves. For non-OTHER picks the textarea stays optional (whatever the
  // cashier types still flows to the kitchen comanda).
  const commentRequired = reasonCode === 'OTHER';
  const commentValid = commentRequired ? commentClean.length >= REASON_MIN_LENGTH : true;
  const pinValid = pin.length >= PIN_MIN_LENGTH;
  const canSubmit = reasonCode != null && commentValid && pinValid && !busy;

  function pressKey(digit: string) {
    if (busy) return;
    setPin((current) => (current.length >= 6 ? current : current + digit));
  }
  function pressBackspace() {
    if (busy) return;
    setPin((current) => current.slice(0, -1));
  }

  function submit() {
    if (!canSubmit || reasonCode == null) return;
    // Drop empty comments so non-OTHER paths don't store a blank string —
    // the parent will skip the field entirely instead of sending "".
    onConfirm({
      reasonCode,
      reason: commentClean.length > 0 ? commentClean : undefined,
      pin,
    });
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
            <IconClose style={{ fontSize: 20 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={styles.title}>{t('remove.title')}</h2>
            <div style={styles.sub}>{t('remove.subtitle').replace('{item}', itemName)}</div>
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
            <div style={styles.fieldLabel}>{t('remove.reasonLabel')}</div>
            <div style={styles.reasonGrid}>
              {REASON_OPTIONS.map((opt) => {
                const active = reasonCode === opt.code;
                const helperGreen = opt.code === 'BEFORE_PREP';
                return (
                  <button
                    key={opt.code}
                    type="button"
                    style={reasonBtnStyle(active)}
                    onClick={() => !busy && setReasonCode(opt.code)}
                    disabled={busy}
                  >
                    <span style={styles.reasonLabel}>{t(opt.labelKey)}</span>
                    {opt.helperKey && (
                      <span style={helperGreen ? styles.reasonHelperGreen : styles.reasonHelper}>
                        {t(opt.helperKey)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={styles.fieldLabel}>
              {t('remove.commentLabel')}
              <span style={styles.optionalTag}>
                {commentRequired ? t('common.required') : t('common.optional')}
              </span>
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('remove.commentPlaceholder')}
              style={styles.commentInput}
              maxLength={500}
              disabled={busy}
            />
            <div style={styles.commentHint}>
              <span
                style={{
                  color:
                    !commentRequired || commentValid ? 'var(--green)' : 'var(--text3)',
                }}
              >
                {commentRequired
                  ? commentValid
                    ? t('cancel.lengthOk')
                    : t('cancel.lengthMin').replace('{n}', String(REASON_MIN_LENGTH))
                  : t('remove.commentOptionalHint')}
              </span>
              <span>{commentClean.length}/500</span>
            </div>
          </div>

          <div>
            <div style={styles.fieldLabel}>
              <IconShield style={{ fontSize: 14 }} />
              {t('remove.confirmPin')}
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
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={confirmBtnStyle(canSubmit)}
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? <Spinner size={14} /> : <IconClose style={{ fontSize: 16 }} />}
            {t('remove.confirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
