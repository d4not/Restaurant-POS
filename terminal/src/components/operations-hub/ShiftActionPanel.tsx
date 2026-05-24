import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeRegister,
  fetchCurrentRegister,
  openRegister,
} from '../../api/registers';
import { fetchSettings, type SettingsMap } from '../../api/settings';
import { ApiError } from '../../api/client';
import { useSession } from '../../store/session';
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
    if (!open) return;
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
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('register.couldNotClose')),
  });

  function handleDismiss() {
    if (closeResult) {
      queryClient.setQueryData(['register', 'current'], null);
      invalidateRegisterQueries();
    }
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
        return;
      }
      if (e.key === 'Enter' && closeResult) {
        e.preventDefault();
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
    <div style={hubStyles.childScrim} onClick={handleDismiss}>
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
            <CloseResultsBody result={closeResult!} currency={currency} />
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

interface CloseResultsBodyProps {
  result: CloseResult;
  currency: string;
}

function CloseResultsBody({ result, currency }: CloseResultsBodyProps) {
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

  const hints = diffNum !== 0
    ? analyzeShortage({ diffCentavos: diffNum, currency })
    : [];

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
      {hints.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <ShortageAnalyzer hints={hints} currency={currency} />
        </div>
      )}
    </>
  );
}
