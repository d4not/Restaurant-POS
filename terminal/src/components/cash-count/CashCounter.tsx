/**
 * Currency-aware cash counting widget. Lists denominations of the active
 * currency, accepts a count per denomination, computes the total live, and
 * (optionally) shows the variance against an expected amount.
 *
 * Daniel's brief: a cashier should *count*, not multiply. This component is
 * the embodiment of that — every denomination is a row, every row has a
 * stepper, and the cashier only ever enters integers. The sum lives in the
 * header so they never have to scroll back up to know where they stand.
 *
 * Two modes:
 *   - Standard: `expected` is rendered alongside the running total so the
 *     cashier can self-correct as they count.
 *   - `blind` (REPORTS-SPEC blind-close): `expected` is hidden until the
 *     close is committed. The difference row reads "—" so the operator can't
 *     reverse-engineer the expected value mid-count.
 *
 * Controlled. Pair with `useCashCounter` from `hooks/useCashCounter` if the
 * parent doesn't want to manage state itself.
 */

import { useMemo } from 'react';
import {
  breakdownToCentavos,
  formatCurrencyAmount,
  getTerminalDenominations,
  smallestBillCentavos,
  visibleDenominations,
  type CashBreakdown,
} from '../../utils/cashCount';
import { DenominationRow } from './DenominationRow';
import { useCashCountT } from './i18n';

export interface CashCounterProps {
  currency: string;
  value: CashBreakdown;
  onChange: (next: CashBreakdown) => void;
  /** Hide `expected` and the variance until the cashier finishes (blind close). */
  blind?: boolean;
  /** Expected amount in centavos. Ignored when `blind`. */
  expected?: number;
  /** Default true — strip MXN $0.50 / sub-cent coins from the visible list. */
  hideSubunits?: boolean;
  /** Override the subunit cutoff if the locale wants something other than $1. */
  subunitFloor?: number;
  /** Append extra controls (reset, suggest, "notify manager") in the header right slot. */
  headerExtra?: React.ReactNode;
  /** Footer slot for things like "Continue" / "Confirm" buttons. */
  footer?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const shell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg)',
  borderRadius: 14,
  border: '1px solid var(--border)',
  overflow: 'hidden',
  minHeight: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'flex-end',
  gap: 16,
  padding: '18px 22px 14px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg2)',
};

const titleStyle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const totalsBlock: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'flex-end',
  fontVariantNumeric: 'tabular-nums',
  minWidth: 220,
};

const totalsRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 18,
  fontSize: 13,
  color: 'var(--text2)',
  width: '100%',
};

const totalAmount: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 28,
  fontWeight: 700,
  color: 'var(--text1)',
};

const diffBalanced: React.CSSProperties = { color: 'var(--green)', fontWeight: 600 };
const diffShort: React.CSSProperties = { color: 'var(--red)', fontWeight: 600 };
const diffOver: React.CSSProperties = { color: 'var(--gold)', fontWeight: 600 };

const blindBanner: React.CSSProperties = {
  padding: '10px 22px',
  background: 'rgba(201,164,92,0.12)',
  color: '#7a5c3a',
  fontSize: 12,
  letterSpacing: '0.04em',
  textAlign: 'center',
  borderBottom: '1px solid rgba(201,164,92,0.3)',
};

const sectionWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '14px 22px',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  margin: '4px 4px 0',
};

const scrollWrap: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const footerWrap: React.CSSProperties = {
  padding: '12px 22px 16px',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg2)',
};

const emptyState: React.CSSProperties = {
  padding: '24px 14px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
};

export function CashCounter(props: CashCounterProps) {
  const {
    currency,
    value,
    onChange,
    blind = false,
    expected,
    hideSubunits = true,
    subunitFloor,
    headerExtra,
    footer,
    className,
    style,
  } = props;

  const t = useCashCountT();

  const denoms = useMemo(() => {
    const all = getTerminalDenominations(currency);
    if (!hideSubunits) return all;
    const floor = subunitFloor ?? 100;
    return visibleDenominations(all, floor);
  }, [currency, hideSubunits, subunitFloor]);

  const coinThreshold = smallestBillCentavos(currency);
  const bills = denoms.filter((d) => d >= coinThreshold);
  const coins = denoms.filter((d) => d < coinThreshold);

  const total = useMemo(() => breakdownToCentavos(value), [value]);
  const showExpected = !blind && typeof expected === 'number';
  const diff = showExpected ? total - (expected ?? 0) : 0;
  const balanced = showExpected && diff === 0;
  const sign: 'short' | 'over' | null = !showExpected ? null : diff < 0 ? 'short' : diff > 0 ? 'over' : null;

  const setCount = (denom: number, count: number) => {
    const next = { ...value };
    const safe = Math.max(0, Math.floor(count));
    if (safe === 0) delete next[String(denom)];
    else next[String(denom)] = safe;
    onChange(next);
  };

  const increment = (denom: number) => {
    const current = Number(value[String(denom)] ?? 0);
    onChange({ ...value, [String(denom)]: current + 1 });
  };

  const decrement = (denom: number) => {
    const current = Number(value[String(denom)] ?? 0);
    const next = { ...value };
    const nextCount = Math.max(0, current - 1);
    if (nextCount === 0) delete next[String(denom)];
    else next[String(denom)] = nextCount;
    onChange(next);
  };

  const diffLabel = balanced
    ? t('cashCount.diff.balanced')
    : sign === 'short'
    ? t('cashCount.diff.short')
    : sign === 'over'
    ? t('cashCount.diff.over')
    : '';

  return (
    <section className={className} style={{ ...shell, ...style }}>
      <header style={headerStyle}>
        <div>
          <h2 style={titleStyle}>{t('cashCount.title')}</h2>
        </div>
        <div style={totalsBlock}>
          <div style={totalsRow}>
            <span>{t('cashCount.total')}</span>
            <span style={totalAmount}>{formatCurrencyAmount(total, currency)}</span>
          </div>
          {showExpected && (
            <div style={totalsRow}>
              <span>{t('cashCount.expected')}</span>
              <span>{formatCurrencyAmount(expected ?? 0, currency)}</span>
            </div>
          )}
          {showExpected && (
            <div style={totalsRow}>
              <span>{t('cashCount.difference')}</span>
              <span
                style={
                  balanced
                    ? diffBalanced
                    : sign === 'short'
                    ? diffShort
                    : sign === 'over'
                    ? diffOver
                    : undefined
                }
              >
                {balanced
                  ? diffLabel
                  : `${formatCurrencyAmount(Math.abs(diff), currency)} ${diffLabel}`}
              </span>
            </div>
          )}
          {headerExtra}
        </div>
      </header>

      {blind && <div style={blindBanner}>{t('cashCount.blind.banner')}</div>}

      <div style={scrollWrap}>
        {bills.length > 0 && (
          <div style={sectionWrap}>
            <div style={sectionLabel}>{t('cashCount.bills')}</div>
            {bills.map((d) => (
              <DenominationRow
                key={d}
                denomCentavos={d}
                count={Number(value[String(d)] ?? 0)}
                currency={currency}
                onIncrement={() => increment(d)}
                onDecrement={() => decrement(d)}
                onSetCount={(c) => setCount(d, c)}
              />
            ))}
          </div>
        )}

        {coins.length > 0 && (
          <div style={sectionWrap}>
            <div style={sectionLabel}>{t('cashCount.coins')}</div>
            {coins.map((d) => (
              <DenominationRow
                key={d}
                denomCentavos={d}
                count={Number(value[String(d)] ?? 0)}
                currency={currency}
                isCoin
                onIncrement={() => increment(d)}
                onDecrement={() => decrement(d)}
                onSetCount={(c) => setCount(d, c)}
              />
            ))}
          </div>
        )}

        {bills.length === 0 && coins.length === 0 && (
          <div style={emptyState}>{t('cashCount.empty')}</div>
        )}
      </div>

      {footer && <div style={footerWrap}>{footer}</div>}
    </section>
  );
}
