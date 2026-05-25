import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeRegister,
  fetchCurrentRegister,
  flagShiftForReview,
  openRegister,
} from '../../api/registers';
import { fetchSettings, type SettingsMap } from '../../api/settings';
import { ApiError } from '../../api/client';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { Spinner } from '../Spinner';
import { formatMoney } from '../../utils/format';
import { useTranslation } from '../../i18n';
import { CashCounter } from '../cash-count';
import { ShortageAnalyzer } from '../cash-count/ShortageAnalyzer';
import { useCashCounter } from '../../hooks/useCashCounter';
import { analyzeShortage } from '../../utils/shortage-analysis';
import type { CashBreakdown } from '../../utils/cashCount';
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
  diffZero: { color: 'var(--green)' },
  diffPos: { color: 'var(--gold)' },
  diffNeg: { color: 'var(--red)' },
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

function settingBool(settings: SettingsMap | undefined, key: string, fallback: boolean): boolean {
  if (!settings || !(key in settings)) return fallback;
  return settings[key] !== 'false';
}

interface CloseResult {
  submittedAmount: number;
  expectedAmount: string;
  difference: string;
  breakdown?: CashBreakdown;
}

export function ShiftActionPanel({ open, onClose }: ShiftActionPanelProps) {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canManage = ROLES_WITH_REGISTER.has(role);
  const queryClient = useQueryClient();

  const registerQuery = useQuery({
    queryKey: ['register', 'current'],
    queryFn: fetchCurrentRegister,
    enabled: open && canManage,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const currency = settingsQuery.data?.currency ?? 'MXN';
  const hideSubunits = settingBool(settingsQuery.data, 'cash_count_hide_subunits', true);

  const openCounter = useCashCounter({ currency, hideSubunits });
  const closeCounter = useCashCounter({ currency, hideSubunits });

  const [error, setError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);

  useEffect(() => {
    if (!open) {
      // Clear the flag if the panel is closed externally (safety net)
      useUi.getState().setShiftCloseInProgress(false);
      return;
    }
    openCounter.reset();
    closeCounter.reset();
    setError(null);
    setCloseResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function invalidateRegisterQueries() {
    queryClient.invalidateQueries({ queryKey: ['register'] });
  }

  const openMutation = useMutation({
    mutationFn: (input: { amount: number; breakdown: CashBreakdown }) =>
      openRegister({
        opening_amount: input.amount,
        denomination_breakdown: Object.keys(input.breakdown).length > 0
          ? input.breakdown
          : undefined,
      }),
    onSuccess: (reg) => {
      queryClient.setQueryData(['register', 'current'], reg);
      invalidateRegisterQueries();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotOpen')),
  });

  const closeMutation = useMutation({
    mutationFn: (input: { id: string; amount: number; breakdown: CashBreakdown }) =>
      closeRegister(input.id, {
        actual_amount: input.amount,
        denomination_breakdown: Object.keys(input.breakdown).length > 0
          ? input.breakdown
          : undefined,
      }),
    onSuccess: (closed, variables) => {
      setCloseResult({
        submittedAmount: variables.amount,
        expectedAmount: closed.expected_amount,
        difference: closed.difference ?? '0',
        breakdown: variables.breakdown,
      });
      // Tell App.tsx not to navigate to NoActiveShiftScreen while the
      // results are displayed. Without this, the 30s refetchInterval
      // fetches null (no OPEN register) and unmounts our modal tree.
      useUi.getState().setShiftCloseInProgress(true);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotClose')),
  });

  function handleDismiss() {
    useUi.getState().setShiftCloseInProgress(false);
    if (closeResult) {
      queryClient.setQueryData(['register', 'current'], null);
      invalidateRegisterQueries();
    }
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // When results are showing, block all keyboard dismissal — the user
      // must interact with the explicit action button (Acknowledged or
      // Send for admin review).
      if (closeResult) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closeResult]);

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
      if (reg.is_provisional) {
        setError(t('provisional.closeBlocked'));
        return;
      }
      if (closeCounter.total === 0) {
        setError(t('register.enterCounted'));
        return;
      }
      closeMutation.mutate({
        id: reg.id,
        amount: closeCounter.total,
        breakdown: closeCounter.breakdown,
      });
    } else {
      openMutation.mutate({
        amount: openCounter.total,
        breakdown: openCounter.breakdown,
      });
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
    subtitle = t('register.countByDenominationHint');
  } else {
    title = t('register.openShift');
    subtitle = t('register.countByDenominationHint');
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

  const modalStyle = isResults ? hubStyles.childModal : hubStyles.wideChildModal;

  return (
    <div
      style={hubStyles.childScrim}
      onClick={isResults ? (e: React.MouseEvent) => e.stopPropagation() : handleDismiss}
    >
      <div style={modalStyle} onClick={(e) => e.stopPropagation()} role="dialog">
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
            <CloseResultsBody
              result={closeResult!}
              currency={currency}
              registerId={reg?.id ?? null}
              onDismiss={handleDismiss}
            />
          ) : reg ? (
            <>
              <CashCounter
                currency={currency}
                value={closeCounter.breakdown}
                onChange={closeCounter.applyBreakdown}
                blind
                hideSubunits={hideSubunits}
              />
              <div style={localStyles.endDayNote}>{t('register.endDayInAdmin')}</div>
            </>
          ) : (
            <CashCounter
              currency={currency}
              value={openCounter.breakdown}
              onChange={openCounter.applyBreakdown}
              hideSubunits={hideSubunits}
            />
          )}
          {error && !isResults && <div style={hubStyles.errBanner}>{error}</div>}
        </div>

        {!isResults && (
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
        )}
      </div>
    </div>
  );
}

interface CloseResultsBodyProps {
  result: CloseResult;
  currency: string;
  registerId: string | null;
  onDismiss: () => void;
}

function CloseResultsBody({ result, currency, registerId, onDismiss }: CloseResultsBodyProps) {
  const { t } = useTranslation();
  const diffNum = Number(result.difference);
  const isBalanced = diffNum === 0;

  if (isBalanced) {
    return <BalancedResultScreen result={result} onDismiss={onDismiss} />;
  }
  return (
    <DiscrepancyResultScreen
      result={result}
      currency={currency}
      registerId={registerId}
      onDismiss={onDismiss}
    />
  );
}

function BalancedResultScreen({
  result,
  onDismiss,
}: {
  result: CloseResult;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={resultStyles.container}>
      <div style={resultStyles.iconWrap}>
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
          <circle cx="28" cy="28" r="28" fill="rgba(74,140,92,0.12)" />
          <path
            d="M18 28.5L25 35.5L38 22.5"
            stroke="var(--green)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h3 style={resultStyles.titleGreen}>{t('register.allGood')}</h3>
      <p style={resultStyles.subtitle}>{t('register.allGoodSub')}</p>

      <div style={{ ...localStyles.resultsGrid, marginTop: 20 }}>
        <span>{t('register.expected')}</span>
        <span style={localStyles.resultsAmt}>{formatMoney(result.expectedAmount)}</span>
        <span>{t('register.counted')}</span>
        <span style={localStyles.resultsAmt}>{formatMoney(result.submittedAmount)}</span>
      </div>
      <div style={{ ...localStyles.resultsGrid, ...localStyles.diffRow, ...localStyles.diffZero }}>
        <span>{t('register.difference')}</span>
        <span style={{ ...localStyles.diffAmt, color: 'inherit' }}>{formatMoney(0)}</span>
      </div>

      <button type="button" style={resultStyles.greenBtn} onClick={onDismiss}>
        {t('register.acknowledged')}
      </button>
    </div>
  );
}

function DiscrepancyResultScreen({
  result,
  currency,
  registerId,
  onDismiss,
}: {
  result: CloseResult;
  currency: string;
  registerId: string | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [flagging, setFlagging] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  const diffNum = Number(result.difference);
  const isShortage = diffNum < 0;
  const diffStyle = isShortage ? localStyles.diffNeg : localStyles.diffPos;
  const diffPrefix = diffNum > 0 ? '+' : '';

  const hints = analyzeShortage({ diffCentavos: diffNum, currency });

  async function handleFlagForReview() {
    if (!registerId) {
      onDismiss();
      return;
    }
    setFlagging(true);
    setFlagError(null);
    try {
      await flagShiftForReview(registerId);
      onDismiss();
    } catch (err) {
      setFlagError(err instanceof ApiError ? err.message : t('register.flaggingError'));
      setFlagging(false);
    }
  }

  return (
    <div style={resultStyles.container}>
      <div style={resultStyles.iconWrap}>
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
          <circle
            cx="28"
            cy="28"
            r="28"
            fill={isShortage ? 'rgba(196,80,64,0.12)' : 'rgba(201,164,92,0.14)'}
          />
          <path
            d="M28 18V32M28 36V38"
            stroke={isShortage ? 'var(--red)' : 'var(--gold)'}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h3 style={isShortage ? resultStyles.titleRed : resultStyles.titleGold}>
        {t('register.discrepancyDetected')}
      </h3>
      <p style={resultStyles.subtitle}>{t('register.discrepancySub')}</p>

      <div style={{ ...localStyles.resultsGrid, marginTop: 20 }}>
        <span>{t('register.expected')}</span>
        <span style={localStyles.resultsAmt}>{formatMoney(result.expectedAmount)}</span>
        <span>{t('register.counted')}</span>
        <span style={localStyles.resultsAmt}>{formatMoney(result.submittedAmount)}</span>
      </div>
      <div style={{ ...localStyles.resultsGrid, ...localStyles.diffRow, ...diffStyle }}>
        <span>{t('register.difference')}</span>
        <span style={{ ...localStyles.diffAmt, color: 'inherit' }}>
          {diffPrefix + formatMoney(result.difference)}
        </span>
      </div>

      {hints.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <ShortageAnalyzer hints={hints} currency={currency} />
        </div>
      )}

      {flagError && <div style={resultStyles.errBanner}>{flagError}</div>}

      <button
        type="button"
        style={isShortage ? resultStyles.redBtn : resultStyles.goldBtn}
        onClick={handleFlagForReview}
        disabled={flagging}
      >
        {flagging && <Spinner size={12} />}
        {t('register.sendForReview')}
      </button>
    </div>
  );
}

const resultStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  iconWrap: {
    marginBottom: 14,
  },
  titleGreen: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--green)',
    margin: 0,
  },
  titleRed: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--red)',
    margin: 0,
  },
  titleGold: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--gold)',
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text2)',
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 1.4,
  },
  greenBtn: {
    marginTop: 22,
    width: '100%',
    padding: '14px 18px',
    borderRadius: 10,
    background: 'var(--green)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    minHeight: 52,
  },
  redBtn: {
    marginTop: 22,
    width: '100%',
    padding: '14px 18px',
    borderRadius: 10,
    background: 'var(--red)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    minHeight: 52,
  },
  goldBtn: {
    marginTop: 22,
    width: '100%',
    padding: '14px 18px',
    borderRadius: 10,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 15,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    minHeight: 52,
  },
  errBanner: {
    marginTop: 12,
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 12,
    background: 'rgba(196,80,64,0.08)',
    color: 'var(--red)',
    border: '1px solid rgba(196,80,64,0.25)',
    textAlign: 'center',
  },
};
