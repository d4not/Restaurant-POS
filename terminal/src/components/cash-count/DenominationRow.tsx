import { type ChangeEvent } from 'react';
import { useCashCountT } from './i18n';
import { formatCurrencyAmount } from '../../utils/cashCount';

export interface DenominationRowProps {
  denomCentavos: number;
  count: number;
  currency: string;
  isCoin?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetCount: (count: number) => void;
}

function formatDenomLabel(centavos: number, currency: string): string {
  const value = centavos / 100;
  const locale = currency === 'USD' ? 'en-US' : 'es-MX';
  const isWhole = Number.isInteger(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'MXN',
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: isWhole ? 0 : 2,
    }).format(value);
  } catch {
    return isWhole ? `$${value}` : `$${value.toFixed(2)}`;
  }
}

const tile: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '14px 16px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderLeft: '3px solid var(--border)',
  borderRadius: 12,
  transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
};

const tileActive: React.CSSProperties = {
  ...tile,
  borderLeftColor: 'var(--gold)',
  background: 'rgba(201,164,92,0.05)',
  boxShadow: '0 2px 12px rgba(201,164,92,0.08)',
};

const topRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};

const denomStyle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1,
};

const denomCoinStyle: React.CSSProperties = {
  ...denomStyle,
  fontSize: 18,
};

const subtotalMuted: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text3)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1,
  transition: 'color 0.15s',
};

const subtotalGold: React.CSSProperties = {
  ...subtotalMuted,
  color: '#8a6d2a',
};

const stepperWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
};

const btnBase: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 10,
  fontSize: 20,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.1s, opacity 0.1s',
  WebkitTapHighlightColor: 'transparent',
};

const minusBtn: React.CSSProperties = {
  ...btnBase,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  color: 'var(--text2)',
};

const minusBtnOff: React.CSSProperties = {
  ...minusBtn,
  opacity: 0.3,
  cursor: 'not-allowed',
};

const plusBtn: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(201,164,92,0.14)',
  border: '1px solid rgba(201,164,92,0.3)',
  color: '#6b5030',
};

const countInput: React.CSSProperties = {
  width: 56,
  height: 44,
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  textAlign: 'center',
  fontSize: 18,
  fontFamily: "'Playfair Display', serif",
  fontWeight: 700,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  outline: 'none',
  transition: 'border-color 0.15s, background 0.15s',
};

const countInputActive: React.CSSProperties = {
  ...countInput,
  borderColor: 'rgba(201,164,92,0.4)',
  background: 'var(--bg2)',
};

export function DenominationRow(props: DenominationRowProps) {
  const { denomCentavos, count, currency, isCoin, onIncrement, onDecrement, onSetCount } =
    props;
  const t = useCashCountT();
  const subtotal = denomCentavos * count;
  const active = count > 0;

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    const parsed = raw === '' ? 0 : Number(raw);
    onSetCount(Math.max(0, Math.min(parsed, 9999)));
  };

  return (
    <div style={active ? tileActive : tile}>
      <div style={topRow}>
        <span
          style={isCoin ? denomCoinStyle : denomStyle}
          aria-label={`Denomination ${formatCurrencyAmount(denomCentavos, currency)}`}
        >
          {formatDenomLabel(denomCentavos, currency)}
        </span>
        <span style={active ? subtotalGold : subtotalMuted}>
          {formatCurrencyAmount(subtotal, currency)}
        </span>
      </div>

      <div style={stepperWrap}>
        <button
          type="button"
          style={count <= 0 ? minusBtnOff : minusBtn}
          onClick={onDecrement}
          disabled={count <= 0}
          aria-label={t('common.remove') ?? 'Remove'}
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={count}
          onChange={handleInput}
          style={active ? countInputActive : countInput}
          aria-label={t('cashCount.count')}
        />
        <button
          type="button"
          style={plusBtn}
          onClick={onIncrement}
          aria-label={t('common.add') ?? 'Add'}
        >
          +
        </button>
      </div>
    </div>
  );
}
