import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeRegister,
  fetchOpenRegister,
  openRegister,
  type CashRegisterRow,
} from '../../api/registers';
import { ApiError } from '../../api/client';
import { useSession } from '../../store/session';
import { Spinner } from '../Spinner';
import { formatMoney, formatMoneyPlain } from '../../utils/format';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';

interface ShiftActionPanelProps {
  open: boolean;
  onClose: () => void;
}

const ROLES_WITH_REGISTER: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

const localStyles: Record<string, React.CSSProperties> = {
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
  diffPos: { color: 'var(--green)' },
  diffNeg: { color: 'var(--red)' },
};

function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

// Sub-modal for opening/closing the cash register. Mounted as a child of the
// Operations Hub at zIndex 80. Replaces the previous standalone
// ShiftManagerModal — same logic, no scrim/modal of its own (the panel manages
// its own scrim so it can stack above the hub).
export function ShiftActionPanel({ open, onClose }: ShiftActionPanelProps) {
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

  const [openingInput, setOpeningInput] = useState('');
  const [actualInput, setActualInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOpeningInput('');
    setActualInput('');
    setError(null);
  }, [open]);

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

  // Esc/Enter only fires when this panel is the topmost modal (zIndex 80) —
  // listener removed on close so the hub's own listener doesn't get
  // double-fired when this panel unmounts.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
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
      <div style={hubStyles.childScrim} onClick={onClose}>
        <div style={hubStyles.childModal} onClick={(e) => e.stopPropagation()}>
          <div style={hubStyles.head}>
            <h2 style={hubStyles.title}>{t('register.shiftMgmt')}</h2>
            <div style={hubStyles.sub}>{t('register.shiftMgmtSub')}</div>
          </div>
          <div style={hubStyles.actions}>
            <button type="button" style={hubStyles.primaryBtn} onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const reg = registerQuery.data;

  function submit() {
    setError(null);
    if (registerQuery.isLoading) return;
    if (reg) {
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
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div style={hubStyles.childModal} onClick={(e) => e.stopPropagation()} role="dialog">
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>
            {reg ? t('register.closeShift') : t('register.openShift')}
          </h2>
          <div style={hubStyles.sub}>
            {reg ? t('register.closeShiftSub') : t('register.openShiftSub')}
          </div>
        </div>

        <div style={hubStyles.body}>
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
          {error && <div style={hubStyles.errBanner}>{error}</div>}
        </div>

        <div style={hubStyles.actions}>
          <button type="button" style={hubStyles.cancelBtn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={hubStyles.primaryBtn}
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
    <div style={hubStyles.field}>
      <label style={hubStyles.label}>{t('register.openingCash')} (MXN)</label>
      <input
        autoFocus
        inputMode="decimal"
        style={hubStyles.input}
        placeholder="500.00"
        value={openingInput}
        onChange={(e) => setOpeningInput(e.target.value)}
      />
      <span style={hubStyles.hint}>{t('register.openingHint')}</span>
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
      <div style={localStyles.summaryGrid}>
        <span>{t('register.openedWith')}</span>
        <span style={localStyles.summaryAmt}>{formatMoney(register.opening_amount)}</span>
        <span>{t('register.expectedDrawer')}</span>
        <span style={localStyles.summaryAmt}>{formatMoney(register.expected_amount)}</span>
      </div>
      <div style={hubStyles.field}>
        <label style={hubStyles.label}>{t('register.countedCashLabel')} (MXN)</label>
        <input
          autoFocus
          inputMode="decimal"
          style={hubStyles.input}
          placeholder={formatMoneyPlain(register.expected_amount)}
          value={actualInput}
          onChange={(e) => setActualInput(e.target.value)}
        />
      </div>
      {diffPreview && (
        <div
          style={{
            ...localStyles.summaryGrid,
            ...localStyles.diffRow,
            ...(diffPreview.sign === 'pos'
              ? localStyles.diffPos
              : diffPreview.sign === 'neg'
                ? localStyles.diffNeg
                : {}),
          }}
        >
          <span>{t('register.difference')}</span>
          <span style={{ ...localStyles.summaryAmt, color: 'inherit' }}>
            {diffPreview.value === 0
              ? formatMoney('0')
              : (diffPreview.value > 0 ? '+' : '') + formatMoney(String(diffPreview.value))}
          </span>
        </div>
      )}
    </>
  );
}
