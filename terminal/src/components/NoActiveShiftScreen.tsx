import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  openRegister,
  type CashRegisterRow,
} from '../api/registers';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useTranslation } from '../i18n';
import { Spinner } from './Spinner';
import { IconRegister } from './operations-hub/HubIcons';

const ROLES_NORMAL_SHIFT: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);
// Admin Mode is manager+ territory — cashiers stay on the Operations Hub for
// their day-to-day management surface. Kept separate from the shift gate so
// the two can move independently if access ever broadens.
const ROLES_ADMIN_MODE: ReadonlySet<string> = new Set(['MANAGER', 'ADMIN']);

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 24px',
    background: 'var(--bg)',
    overflowY: 'auto',
  },
  card: {
    width: '100%',
    maxWidth: 540,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    boxShadow: 'var(--shadow)',
    padding: '36px 36px 32px',
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 30,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
  },
  sub: {
    fontSize: 14,
    color: 'var(--text2)',
    marginTop: 8,
    marginBottom: 28,
    lineHeight: 1.5,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text1)',
  },
  actionTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  actionSub: {
    fontSize: 12,
    color: 'var(--text2)',
    lineHeight: 1.5,
  },
  field: {
    marginTop: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  input: {
    height: 44,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
  },
  cta: {
    marginTop: 12,
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    border: '1px solid var(--text1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  err: {
    marginTop: 12,
    padding: '10px 12px',
    background: 'rgba(196,80,64,0.08)',
    border: '1px solid rgba(196,80,64,0.3)',
    color: 'var(--red)',
    borderRadius: 8,
    fontSize: 13,
  },
  footRow: {
    marginTop: 24,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    color: 'var(--text3)',
  },
  signOutBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--text2)',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  adminRow: {
    marginTop: 18,
    paddingTop: 16,
    borderTop: '1px dashed var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  adminText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  adminTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  adminHint: {
    fontSize: 11,
    color: 'var(--text3)',
    lineHeight: 1.4,
  },
  adminBtn: {
    padding: '10px 16px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid var(--text1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
};

function actionCardStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '20px 22px',
    borderRadius: 12,
    border: '1px solid ' + (active ? 'var(--gold)' : 'var(--border)'),
    background: active ? 'rgba(201,164,92,0.08)' : 'var(--bg)',
    minHeight: 168,
    opacity: active ? 1 : 0.6,
  };
}

function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  if (cleaned === '') return null;
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

// Full-screen entry gate. Mounted by App.tsx whenever no shift is OPEN.
// Cashier+ counts the drawer up front; floor staff (waiter/barista) can
// instead open a PROVISIONAL shift — orders flow as normal, but cash in/out
// is blocked until a cashier arrives and verifies the count.
export function NoActiveShiftScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const signOut = useSession((s) => s.signOut);
  const openAdmin = useUi((s) => s.openAdmin);
  const canOpenNormal = ROLES_NORMAL_SHIFT.has(role);
  const canEnterAdmin = ROLES_ADMIN_MODE.has(role);

  const [openingInput, setOpeningInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSuccess(reg: CashRegisterRow) {
    queryClient.setQueryData(['register', 'current'], reg);
    queryClient.invalidateQueries({ queryKey: ['register'] });
  }

  const openMutation = useMutation({
    mutationFn: (amountCentavos: number) => openRegister({ opening_amount: amountCentavos }),
    onSuccess,
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotOpen')),
  });

  function submit() {
    setError(null);
    const amt = parseAmount(openingInput);
    if (amt == null) {
      setError(t('register.enterStarting'));
      return;
    }
    openMutation.mutate(amt);
  }

  const ctaLabel = canOpenNormal
    ? t('noShift.openNormal')
    : t('noShift.openProvisional');
  const cardTitle = canOpenNormal
    ? t('noShift.openNormal')
    : t('noShift.openProvisional');
  const cardSub = canOpenNormal
    ? t('noShift.openNormalSub')
    : t('noShift.openProvisionalSub');

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <h1 style={styles.title}>{t('noShift.title')}</h1>
        <p style={styles.sub}>{t('noShift.subtitle')}</p>

        <div style={actionCardStyle(true)}>
          <div style={styles.actionIcon}><IconRegister /></div>
          <div style={styles.actionTitle}>{cardTitle}</div>
          <div style={styles.actionSub}>{cardSub}</div>
        </div>

        <div style={styles.field}>
          <span style={styles.label}>{t('register.openingCash')} (MXN)</span>
          <input
            autoFocus
            inputMode="decimal"
            style={styles.input}
            placeholder="500.00"
            value={openingInput}
            onChange={(e) => setOpeningInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{t('register.openingHint')}</span>
        </div>

        <button
          type="button"
          style={styles.cta}
          onClick={submit}
          disabled={openMutation.isPending}
        >
          {openMutation.isPending && <Spinner size={14} />}
          {ctaLabel}
        </button>

        {error && <div style={styles.err}>{error}</div>}

        {canEnterAdmin && (
          <div style={styles.adminRow}>
            <div style={styles.adminText}>
              <span style={styles.adminTitle}>{t('noShift.adminTitle')}</span>
              <span style={styles.adminHint}>{t('noShift.adminHint')}</span>
            </div>
            <button type="button" style={styles.adminBtn} onClick={openAdmin}>
              {t('noShift.adminCta')}
            </button>
          </div>
        )}

        <div style={styles.footRow}>
          <span>{t('login.signedInAs')} · {role}</span>
          <button type="button" style={styles.signOutBtn} onClick={signOut}>
            {t('noShift.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
