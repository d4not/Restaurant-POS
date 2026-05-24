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
  blind?: boolean;
  expected?: number;
  hideSubunits?: boolean;
  subunitFloor?: number;
  headerExtra?: React.ReactNode;
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

const scrollWrap: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const sectionWrap: React.CSSProperties = {
  padding: '14px 22px',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  margin: '0 4px 8px',
};

const denomGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 10,
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
            <div style={denomGrid}>
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
          </div>
        )}

        {coins.length > 0 && (
          <div style={sectionWrap}>
            <div style={sectionLabel}>{t('cashCount.coins')}</div>
            <div style={denomGrid}>
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
