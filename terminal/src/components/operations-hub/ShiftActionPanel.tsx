import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeRegister,
  fetchCurrentRegister,
  openRegister,
  type CashRegisterRow,
} from '../../api/registers';
import { ApiError } from '../../api/client';
import { useSession } from '../../store/session';
import { Spinner } from '../Spinner';
import { formatMoney } from '../../utils/format';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';

interface ShiftActionPanelProps {
  open: boolean;
  onClose: () => void;
}

const ROLES_WITH_REGISTER: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

const localStyles: Record<string, React.CSSProperties> = {
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    columnGap: 16,
    rowGap: 12,
    fontSize: 14,
    color: 'var(--text2)',
  },
  resultsAmt: {
    color: 'var(--text1)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    fontSize: 16,
  },
  diffRow: {
    paddingTop: 14,
    marginTop: 8,
    borderTop: '1px solid var(--border)',
    fontWeight: 700,
    fontSize: 16,
  },
  diffAmt: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  // Blind close colour mapping:
  //   green  → balanced (diff = 0)
  //   amber  → surplus (diff > 0)
  //   red    → shortage (diff < 0)
  diffZero: { color: 'var(--green)' },
  diffPos: { color: 'var(--gold)' },
  diffNeg: { color: 'var(--red)' },
  followUpBanner: {
    marginTop: 14,
    padding: '10px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    background: 'rgba(74,140,92,0.10)',
    color: 'var(--green)',
    lineHeight: 1.4,
  },
};

function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

interface CloseResult {
  closed: CashRegisterRow;
  submittedAmount: number;
  followUp: CashRegisterRow | null;
}

// Sub-modal for opening/closing the cash register. Mounted as a child of the
// Operations Hub at zIndex 80. Replaces the previous standalone
// ShiftManagerModal — same logic, no scrim/modal of its own (the panel manages
// its own scrim so it can stack above the hub).
//
// Close flow follows the blind-close model from REPORTS-SPEC §4.4: the
// cashier sees ONLY the count prompt before submitting. expected_amount and
// difference are revealed once the backend response lands, in a results
// screen that survives until the cashier dismisses it.
export function ShiftActionPanel({ open, onClose }: ShiftActionPanelProps) {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canManage = ROLES_WITH_REGISTER.has(role);
  const queryClient = useQueryClient();

  // Singleton shift lookup — the hub manages whichever shift is currently
  // open, even if it belongs to a different user (provisional → cashier
  // closeout flow).
  const registerQuery = useQuery({
    queryKey: ['register', 'current'],
    queryFn: fetchCurrentRegister,
    enabled: open && canManage,
  });

  const [openingInput, setOpeningInput] = useState('');
  const [actualInput, setActualInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setOpeningInput('');
    setActualInput('');
    setError(null);
    setCloseResult(null);
  }, [open]);

  function invalidateRegisterQueries() {
    queryClient.invalidateQueries({ queryKey: ['register'] });
  }

  const openMutation = useMutation({
    mutationFn: (amountCentavos: number) => openRegister({ opening_amount: amountCentavos }),
    onSuccess: (reg) => {
      queryClient.setQueryData(['register', 'current'], reg);
      invalidateRegisterQueries();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotOpen')),
  });

  // Closing a PROVISIONAL shift is followed automatically by opening a NORMAL
  // shift — the cashier's counted amount becomes the new opening_amount, so
  // cash carries over without a gap.
  //
  // We do NOT call onClose() on success: the response is the first time the
  // cashier sees expected_amount/difference (blind close), so we hold the
  // panel open and render the results screen until they dismiss it.
  const closeMutation = useMutation({
    mutationFn: async ({
      id,
      amountCentavos,
      followUpNormal,
    }: {
      id: string;
      amountCentavos: number;
      followUpNormal: boolean;
    }) => {
      const closed = await closeRegister(id, { actual_amount: amountCentavos });
      if (followUpNormal) {
        const next = await openRegister({ opening_amount: amountCentavos });
        return { closed, next };
      }
      return { closed, next: null };
    },
    onSuccess: ({ closed, next }, variables) => {
      // Reflect the new state in the singleton register cache so the hub /
      // topbar update immediately, even though the panel is still showing the
      // results screen.
      queryClient.setQueryData(['register', 'current'], next);
      invalidateRegisterQueries();
      setCloseResult({
        closed,
        submittedAmount: variables.amountCentavos,
        followUp: next,
      });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotClose')),
  });

  // Esc/Enter only fires when this panel is the topmost modal (zIndex 80) —
  // listener removed on close so the hub's own listener doesn't get
  // double-fired when this panel unmounts.
  //
  // While the results screen is up, both Esc and Enter just dismiss it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (closeResult) {
          onClose();
        } else {
          submit();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openingInput, actualInput, registerQuery.data, closeResult]);

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
    if (closeResult) return;
    if (reg) {
      const amt = parseAmount(actualInput);
      if (amt == null) {
        setError(t('register.enterCounted'));
        return;
      }
      // Provisional shifts roll straight into a normal shift on close, using
      // the counted amount as the new opening cash. Normal shifts just close.
      closeMutation.mutate({
        id: reg.id,
        amountCentavos: amt,
        followUpNormal: reg.kind === 'PROVISIONAL',
      });
    } else {
      const amt = parseAmount(openingInput);
      if (amt == null) {
        setError(t('register.enterStarting'));
        return;
      }
      openMutation.mutate(amt);
    }
  }

  const isResults = closeResult != null;
  const isClosingProvisional = reg?.kind === 'PROVISIONAL';

  let title: string;
  let subtitle: string;
  if (isResults) {
    title = t('register.resultsTitle');
    subtitle = closeResult!.followUp
      ? t('register.resultsSubProvisional')
      : t('register.resultsSubNormal');
  } else if (reg) {
    title = isClosingProvisional ? t('register.closeAndStartNormal') : t('register.closeShift');
    subtitle = isClosingProvisional
      ? t('register.normalShiftAfterProvisional')
      : t('register.closeShiftSub');
  } else {
    title = t('register.openShift');
    subtitle = t('register.openShiftSub');
  }

  let primaryLabel: string;
  if (isResults) {
    primaryLabel = t('common.done');
  } else if (reg) {
    primaryLabel = isClosingProvisional
      ? t('register.submitCountAndStartNormal')
      : t('register.submitCount');
  } else {
    primaryLabel = t('register.openShift');
  }

  const primaryAction = isResults ? onClose : submit;
  const primaryDisabled =
    !isResults &&
    (openMutation.isPending || closeMutation.isPending || registerQuery.isLoading);
  const showCancel = !isResults;
  const showSpinner = !isResults && (openMutation.isPending || closeMutation.isPending);

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div style={hubStyles.childModal} onClick={(e) => e.stopPropagation()} role="dialog">
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>{title}</h2>
          <div style={hubStyles.sub}>{subtitle}</div>
        </div>

        <div style={hubStyles.body}>
          {registerQuery.isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)' }}>
              <Spinner size={16} /> {t('register.checkingState')}
            </div>
          ) : isResults ? (
            <CloseResultsBody result={closeResult!} />
          ) : reg ? (
            <BlindCountBody actualInput={actualInput} setActualInput={setActualInput} />
          ) : (
            <OpenShiftBody openingInput={openingInput} setOpeningInput={setOpeningInput} />
          )}
          {error && !isResults && <div style={hubStyles.errBanner}>{error}</div>}
        </div>

        <div style={hubStyles.actions}>
          {showCancel && (
            <button type="button" style={hubStyles.cancelBtn} onClick={onClose}>
              {t('common.cancel')}
            </button>
          )}
          <button
            type="button"
            style={hubStyles.primaryBtn}
            onClick={primaryAction}
            disabled={primaryDisabled}
          >
            {showSpinner && <Spinner size={12} />}
            {primaryLabel}
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

interface BlindCountBodyProps {
  actualInput: string;
  setActualInput: (value: string) => void;
}

// The pre-submission close screen. Intentionally shows ZERO information
// derived from expected_amount — no opening cash, no expected total, no live
// difference. The cashier counts blind, then the backend response reveals
// expected and difference together in CloseResultsBody.
function BlindCountBody({ actualInput, setActualInput }: BlindCountBodyProps) {
  const { t } = useTranslation();
  return (
    <div style={hubStyles.field}>
      <label style={hubStyles.label}>{t('register.blindCountPrompt')} (MXN)</label>
      <input
        autoFocus
        inputMode="decimal"
        style={hubStyles.input}
        placeholder="0.00"
        value={actualInput}
        onChange={(e) => setActualInput(e.target.value)}
      />
      <span style={hubStyles.hint}>{t('register.blindCountHint')}</span>
    </div>
  );
}

interface CloseResultsBodyProps {
  result: CloseResult;
}

function CloseResultsBody({ result }: CloseResultsBodyProps) {
  const { t } = useTranslation();
  const expectedRaw = result.closed.expected_amount;
  const diffRaw = result.closed.difference ?? '0';
  const diffNum = Number(diffRaw);
  const diffSign: 'pos' | 'neg' | 'zero' =
    diffNum > 0 ? 'pos' : diffNum < 0 ? 'neg' : 'zero';
  const diffStyle =
    diffSign === 'zero'
      ? localStyles.diffZero
      : diffSign === 'pos'
        ? localStyles.diffPos
        : localStyles.diffNeg;
  const diffPrefix = diffNum > 0 ? '+' : '';

  return (
    <>
      <div style={localStyles.resultsGrid}>
        <span>{t('register.expected')}</span>
        <span style={localStyles.resultsAmt}>{formatMoney(expectedRaw)}</span>
        <span>{t('register.counted')}</span>
        <span style={localStyles.resultsAmt}>{formatMoney(result.submittedAmount)}</span>
      </div>
      <div
        style={{
          ...localStyles.resultsGrid,
          ...localStyles.diffRow,
          ...diffStyle,
        }}
      >
        <span>{t('register.difference')}</span>
        <span style={{ ...localStyles.diffAmt, color: 'inherit' }}>
          {diffNum === 0 ? formatMoney(0) : diffPrefix + formatMoney(diffRaw)}
        </span>
      </div>
      {result.followUp && (
        <div style={localStyles.followUpBanner}>
          {t('register.normalShiftAfterProvisional')}
        </div>
      )}
    </>
  );
}
