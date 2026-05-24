import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeRegister,
  fetchCurrentRegister,
  openRegister,
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

// Closing a normal shift is allowed in the POS for mid-day cashier swaps.
// "End the day" (DailyReport close) is intentionally NOT exposed here — it
// lives only in Admin Mode → Shifts so the night cut happens off the
// counter, where the operator can audit the full day's payment breakdown.
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
  // Footer note pointing the operator to Admin Mode for the day cut. Quiet
  // visual weight — the cashier is closing their shift, not closing the day.
  endDayNote: {
    marginTop: 18,
    padding: '10px 12px',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--text2)',
    background: 'var(--bg)',
    border: '1px dashed var(--border)',
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
  submittedAmount: number;
  expectedAmount: string;
  difference: string;
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
  // open, even if it belongs to a different user.
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

  // Blind close: the cashier counts the drawer without seeing the expected
  // value, the backend computes it, and we reveal both numbers on the
  // results screen. The day cut (closing the DailyReport) deliberately does
  // NOT live here — that action moved to Admin Mode → Shifts.
  //
  // We do NOT call onClose() on success: the response is the first time the
  // cashier sees expected_amount/difference, so we hold the panel open and
  // render the results screen until they dismiss it.
  //
  // The cache invalidation is also deferred to dismiss time: if we cleared
  // ['register','current'] here, App.tsx's singleton-shift gate would flip to
  // null mid-flight and unmount the whole TopBar → Operations Hub → this
  // panel, dropping the cashier on NoActiveShiftScreen before they ever see
  // whether the drawer balanced. See handleDismiss() below.
  const closeMutation = useMutation({
    mutationFn: ({
      id,
      amountCentavos,
    }: {
      id: string;
      amountCentavos: number;
    }) => closeRegister(id, { actual_amount: amountCentavos }),
    onSuccess: (closed, variables) => {
      setCloseResult({
        submittedAmount: variables.amountCentavos,
        expectedAmount: closed.expected_amount,
        difference: closed.difference ?? '0',
      });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotClose')),
  });

  // Wraps the parent onClose so dismissing the results screen is the moment
  // we tell the rest of the app the shift is gone. Before that, the singleton
  // register cache still points at the (now-closed-on-the-server) shift, but
  // that's fine — the panel is the only interactive surface while results
  // are up, and the next refetch / invalidation pass will reconcile.
  function handleDismiss() {
    if (closeResult) {
      queryClient.setQueryData(['register', 'current'], null);
      invalidateRegisterQueries();
    }
    onClose();
  }

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
        handleDismiss();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (closeResult) {
          handleDismiss();
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
      // Provisional shifts must be verified via the banner — closing them
      // here would lose the partial-cut audit trail. The backend also
      // refuses, but catching it client-side gives a clearer message.
      if (reg.is_provisional) {
        setError(t('provisional.closeBlocked'));
        return;
      }
      const amt = parseAmount(actualInput);
      if (amt == null) {
        setError(t('register.enterCounted'));
        return;
      }
      closeMutation.mutate({
        id: reg.id,
        amountCentavos: amt,
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

  let title: string;
  let subtitle: string;
  if (isResults) {
    title = t('register.resultsTitle');
    subtitle = t('register.resultsSubNormal');
  } else if (reg) {
    title = t('register.closeShift');
    subtitle = t('register.closeShiftSub');
  } else {
    title = t('register.openShift');
    subtitle = t('register.openShiftSub');
  }

  let primaryLabel: string;
  if (isResults) {
    primaryLabel = t('common.done');
  } else if (reg) {
    primaryLabel = t('register.submitCount');
  } else {
    primaryLabel = t('register.openShift');
  }

  const primaryAction = isResults ? handleDismiss : submit;
  const primaryDisabled =
    !isResults &&
    (openMutation.isPending || closeMutation.isPending || registerQuery.isLoading);
  const showCancel = !isResults;
  const showSpinner = !isResults && (openMutation.isPending || closeMutation.isPending);

  return (
    <div style={hubStyles.childScrim} onClick={handleDismiss}>
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
            <BlindCountBody
              actualInput={actualInput}
              setActualInput={setActualInput}
            />
          ) : (
            <OpenShiftBody openingInput={openingInput} setOpeningInput={setOpeningInput} />
          )}
          {error && !isResults && <div style={hubStyles.errBanner}>{error}</div>}
        </div>

        <div style={hubStyles.actions}>
          {showCancel && (
            <button type="button" style={hubStyles.cancelBtn} onClick={handleDismiss}>
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

// Blind count: no opening cash, no expected total, no live diff. The
// cashier counts the drawer, the backend response then reveals expected and
// difference together in CloseResultsBody. Ending the day is intentionally
// not surfaced here — it lives in Admin Mode → Shifts (the night cut).
function BlindCountBody({
  actualInput,
  setActualInput,
}: BlindCountBodyProps) {
  const { t } = useTranslation();
  return (
    <>
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
      <div style={localStyles.endDayNote}>{t('register.endDayInAdmin')}</div>
    </>
  );
}

interface CloseResultsBodyProps {
  result: CloseResult;
}

function CloseResultsBody({ result }: CloseResultsBodyProps) {
  const { t } = useTranslation();
  const diffNum = Number(result.difference);
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
        <span style={localStyles.resultsAmt}>{formatMoney(result.expectedAmount)}</span>
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
          {diffNum === 0 ? formatMoney(0) : diffPrefix + formatMoney(result.difference)}
        </span>
      </div>
    </>
  );
}
