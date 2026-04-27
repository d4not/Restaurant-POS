import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeRegister,
  fetchOpenRegister,
  openRegister,
  type CashRegisterRow,
} from '../api/registers';
import { ApiError } from '../api/client';
import { useSession } from '../store/session';
import { Spinner } from './Spinner';
import { confirmDialog } from './ConfirmDialog';
import { formatMoney, formatMoneyPlain } from '../utils/format';
import { useTranslation, t as tStatic } from '../i18n';

// Roles that can open or close their own register from the terminal. Waiters
// and baristas don't have a personal register — orders they create attach to a
// cashier's open register, which they don't own.
const ROLES_WITH_REGISTER: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

interface ShiftPillProps {
  onClick: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 999,
    background: 'rgba(232,221,208,0.08)',
    color: '#e8ddd0',
    border: '1px solid rgba(232,221,208,0.12)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 36,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  scrim: {
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
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  head: {
    padding: '22px 24px 16px',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
  },
  sub: {
    fontSize: 13,
    color: 'var(--text2)',
    marginTop: 4,
    lineHeight: 1.45,
  },
  body: {
    padding: '20px 24px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 14,
  },
  label: {
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  input: {
    height: 44,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 16,
    outline: 'none',
    fontFamily: "'Playfair Display', serif",
    fontVariantNumeric: 'tabular-nums',
  },
  hint: {
    fontSize: 11,
    color: 'var(--text3)',
    fontStyle: 'italic',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    rowGap: 6,
    fontSize: 13,
    color: 'var(--text2)',
    marginBottom: 16,
  },
  summaryAmt: {
    color: 'var(--text1)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  },
  diffRow: {
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
    fontWeight: 700,
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
    padding: '11px 18px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 42,
    minWidth: 92,
  },
  primaryBtn: {
    padding: '11px 18px',
    borderRadius: 8,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid var(--text1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 42,
    minWidth: 92,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  errBanner: {
    marginTop: 12,
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    background: 'rgba(196,80,64,0.10)',
    color: 'var(--red)',
  },
  diffPos: { color: 'var(--green)' },
  diffNeg: { color: 'var(--red)' },
};

// ─── Top-bar pill ──────────────────────────────────────────────────────────
// Shows the current shift state (open / closed) inside the TopBar. Clicking
// opens the manage-shift modal; non-cashier roles see a read-only state and
// the modal short-circuits with a hint.

export function ShiftPill({ onClick }: ShiftPillProps) {
  const { t } = useTranslation();
  const userId = useSession((s) => s.user?.id ?? null);
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canManage = ROLES_WITH_REGISTER.has(role);

  // Skip the network entirely for waiters/baristas — they don't own a
  // register, and showing a perpetual "no shift" pill is misleading. Returning
  // null hides the pill from those roles' top bar.
  const enabled = canManage && Boolean(userId);

  const { data, isLoading } = useQuery({
    queryKey: ['register', 'open', userId],
    queryFn: () => fetchOpenRegister(userId!),
    enabled,
    staleTime: 30_000,
  });

  if (!enabled) return null;

  const isOpen = Boolean(data);
  const dotColor = isLoading
    ? 'var(--text3)'
    : isOpen
      ? 'var(--green)'
      : 'var(--red)';

  return (
    <button type="button" style={styles.pill} onClick={onClick}>
      <span style={{ ...styles.pillDot, background: dotColor }} />
      <span>
        {isLoading
          ? t('register.shiftLoading')
          : isOpen
            ? t('register.shiftOpen')
            : t('register.openShift')}
      </span>
    </button>
  );
}

// ─── Manage-shift modal ────────────────────────────────────────────────────
// One modal handles both flows: open (no register exists) and close (register
// exists, cashier wants to settle). The body switches based on data.

interface ModalProps {
  open: boolean;
  onClose: () => void;
}

export function ShiftManagerModal({ open, onClose }: ModalProps) {
  const { t } = useTranslation();
  const userId = useSession((s) => s.user?.id ?? null);
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canManage = ROLES_WITH_REGISTER.has(role);

  const queryClient = useQueryClient();

  const registerQuery = useQuery({
    queryKey: ['register', 'open', userId],
    queryFn: () => fetchOpenRegister(userId!),
    enabled: open && canManage && Boolean(userId),
  });

  // Reset form state on every open so a previously-typed amount doesn't carry
  // over from a closed-then-reopened session.
  useEffect(() => {
    if (!open) return;
    setOpeningInput('');
    setActualInput('');
    setError(null);
  }, [open]);

  const [openingInput, setOpeningInput] = useState('');
  const [actualInput, setActualInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const openMutation = useMutation({
    mutationFn: (amountCentavos: number) => openRegister({ opening_amount: amountCentavos }),
    onSuccess: (reg) => {
      queryClient.setQueryData(['register', 'open', userId], reg);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotOpen')),
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, amountCentavos }: { id: string; amountCentavos: number }) =>
      closeRegister(id, { actual_amount: amountCentavos }),
    onSuccess: () => {
      queryClient.setQueryData(['register', 'open', userId], null);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotClose')),
  });

  // Esc closes the modal, Enter submits the active flow.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openingInput, actualInput, registerQuery.data]);

  if (!open) return null;

  if (!canManage) {
    return (
      <div style={styles.scrim} onClick={onClose}>
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div style={styles.head}>
            <h2 style={styles.title}>{t('register.shiftMgmt')}</h2>
            <div style={styles.sub}>{t('register.shiftMgmtSub')}</div>
          </div>
          <div style={styles.actions}>
            <button type="button" style={styles.primaryBtn} onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const reg = registerQuery.data;

  function parseAmount(input: string): number | null {
    const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
    const parts = cleaned.split('.');
    if (parts.length > 2) return null;
    const value = Number(cleaned);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }

  function submit() {
    setError(null);
    if (registerQuery.isLoading) return;
    if (reg) {
      // Closing an existing shift.
      const amt = parseAmount(actualInput);
      if (amt == null) {
        setError(t('register.enterCounted'));
        return;
      }
      closeMutation.mutate({ id: reg.id, amountCentavos: amt });
    } else {
      const amt = parseAmount(openingInput);
      if (amt == null) {
        setError(t('register.enterStarting'));
        return;
      }
      openMutation.mutate(amt);
    }
  }

  // Closing flow: show counted amount + computed difference preview.
  let diffPreview: { value: number; sign: 'pos' | 'neg' | 'zero' } | null = null;
  if (reg && actualInput) {
    const amt = parseAmount(actualInput);
    if (amt != null) {
      const expected = Number(reg.expected_amount);
      const diff = amt - expected;
      diffPreview = { value: diff, sign: diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'zero' };
    }
  }

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog">
        <div style={styles.head}>
          <h2 style={styles.title}>{reg ? t('register.closeShift') : t('register.openShift')}</h2>
          <div style={styles.sub}>
            {reg ? t('register.closeShiftSub') : t('register.openShiftSub')}
          </div>
        </div>

        <div style={styles.body}>
          {registerQuery.isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)' }}>
              <Spinner size={16} /> {t('register.checkingState')}
            </div>
          ) : reg ? (
            <CloseShiftBody
              register={reg}
              actualInput={actualInput}
              setActualInput={setActualInput}
              diffPreview={diffPreview}
            />
          ) : (
            <OpenShiftBody openingInput={openingInput} setOpeningInput={setOpeningInput} />
          )}

          {error && <div style={styles.errBanner}>{error}</div>}
        </div>

        <div style={styles.actions}>
          <button type="button" style={styles.cancelBtn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={styles.primaryBtn}
            onClick={submit}
            disabled={openMutation.isPending || closeMutation.isPending || registerQuery.isLoading}
          >
            {(openMutation.isPending || closeMutation.isPending) && <Spinner size={12} />}
            {reg ? t('register.closeShift') : t('register.openShift')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface OpenBodyProps {
  openingInput: string;
  setOpeningInput: (value: string) => void;
}

function OpenShiftBody({ openingInput, setOpeningInput }: OpenBodyProps) {
  const { t } = useTranslation();
  return (
    <div style={styles.field}>
      <label style={styles.label}>{t('register.openingCash')} (MXN)</label>
      <input
        autoFocus
        inputMode="decimal"
        style={styles.input}
        placeholder="500.00"
        value={openingInput}
        onChange={(e) => setOpeningInput(e.target.value)}
      />
      <span style={styles.hint}>{t('register.openingHint')}</span>
    </div>
  );
}

interface CloseBodyProps {
  register: CashRegisterRow;
  actualInput: string;
  setActualInput: (value: string) => void;
  diffPreview: { value: number; sign: 'pos' | 'neg' | 'zero' } | null;
}

function CloseShiftBody({ register, actualInput, setActualInput, diffPreview }: CloseBodyProps) {
  const { t } = useTranslation();
  return (
    <>
      <div style={styles.summaryGrid}>
        <span>{t('register.openedWith')}</span>
        <span style={styles.summaryAmt}>{formatMoney(register.opening_amount)}</span>
        <span>{t('register.expectedDrawer')}</span>
        <span style={styles.summaryAmt}>{formatMoney(register.expected_amount)}</span>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>{t('register.countedCashLabel')} (MXN)</label>
        <input
          autoFocus
          inputMode="decimal"
          style={styles.input}
          placeholder={formatMoneyPlain(register.expected_amount)}
          value={actualInput}
          onChange={(e) => setActualInput(e.target.value)}
        />
      </div>
      {diffPreview && (
        <div
          style={{
            ...styles.summaryGrid,
            ...styles.diffRow,
            ...(diffPreview.sign === 'pos'
              ? styles.diffPos
              : diffPreview.sign === 'neg'
                ? styles.diffNeg
                : {}),
          }}
        >
          <span>{t('register.difference')}</span>
          <span style={{ ...styles.summaryAmt, color: 'inherit' }}>
            {diffPreview.value === 0
              ? formatMoney('0')
              : (diffPreview.value > 0 ? '+' : '') + formatMoney(String(diffPreview.value))}
          </span>
        </div>
      )}
    </>
  );
}

// Shared confirm helper exported for callers that want a one-click open with
// $0 / default amount. Currently unused; left in for future "quick open" UX.
export async function confirmAndOpenShift(): Promise<boolean> {
  const ok = await confirmDialog({
    title: tStatic('register.openShiftZero'),
    message: tStatic('register.openShiftZeroSub'),
    confirmLabel: tStatic('register.openShift'),
  });
  if (!ok) return false;
  await openRegister({ opening_amount: 0 });
  return true;
}
