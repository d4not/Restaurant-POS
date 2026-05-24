import { type ChangeEvent } from 'react';
import { formatCurrencyAmount } from '../../utils/cashCount';

export interface DenominationRowProps {
  denomCentavos: number;
  count: number;
  currency: string;
  isCoin?: boolean;
  even?: boolean;
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

const rowBase: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '100px 1fr 110px',
  alignItems: 'center',
  padding: '0 22px',
  height: 52,
  borderBottom: '1px solid var(--border)',
};

const denomLabel: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 17,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
};

const denomCoinLabel: React.CSSProperties = {
  ...denomLabel,
  fontSize: 15,
  color: 'var(--text2)',
};

const inputBase: React.CSSProperties = {
  width: 80,
  height: 36,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'transparent',
  textAlign: 'center',
  fontSize: 16,
  fontFamily: "'Playfair Display', serif",
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  outline: 'none',
  justifySelf: 'center',
  transition: 'border-color 0.15s',
};

const inputActive: React.CSSProperties = {
  ...inputBase,
  borderColor: 'var(--gold)',
};

const subtotalBase: React.CSSProperties = {
  textAlign: 'right',
  fontFamily: "'Playfair Display', serif",
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text3)',
  fontVariantNumeric: 'tabular-nums',
  transition: 'color 0.15s',
};

const subtotalActive: React.CSSProperties = {
  ...subtotalBase,
  color: 'var(--text1)',
};

export function DenominationRow(props: DenominationRowProps) {
  const { denomCentavos, count, currency, isCoin, even = false, onSetCount } = props;
  const subtotal = denomCentavos * count;
  const active = count > 0;

  const rowStyle: React.CSSProperties = {
    ...rowBase,
    background: even ? 'var(--bg2)' : 'rgba(44,36,32,0.025)',
  };

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    const parsed = raw === '' ? 0 : Number(raw);
    onSetCount(Math.max(0, Math.min(parsed, 9999)));
  };

  return (
    <div style={rowStyle}>
      <span style={isCoin ? denomCoinLabel : denomLabel}>
        {formatDenomLabel(denomCentavos, currency)}
      </span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={count}
        onChange={handleInput}
        onFocus={(e) => e.target.select()}
        style={active ? inputActive : inputBase}
        aria-label={`${formatDenomLabel(denomCentavos, currency)} count`}
      />
      <span style={active ? subtotalActive : subtotalBase}>
        {formatCurrencyAmount(subtotal, currency)}
      </span>
    </div>
  );
}
