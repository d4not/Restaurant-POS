/**
 * One row in the CashCounter: a denomination badge, a stepper to set the
 * count, and a live subtotal. Touch targets ≥48px so a thumb on a tablet can
 * hit them confidently.
 *
 * Visual rule: the denomination chip carries the colour. Bills get a
 * `--gold`-tinted chip (rest on the warm cream surface); coins get a flatter
 * neutral chip so the eye glides past the smaller numbers when scanning the
 * total.
 */

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

const baseRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '110px 1fr 110px',
  alignItems: 'center',
  gap: 14,
  padding: '12px 14px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
};

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  padding: '0 14px',
  fontFamily: "'Playfair Display', serif",
  fontWeight: 600,
  fontSize: 18,
  borderRadius: 10,
  fontVariantNumeric: 'tabular-nums',
};

const chipBill: React.CSSProperties = {
  ...chipBase,
  color: '#2c2420',
  background: 'rgba(201,164,92,0.18)',
  border: '1px solid rgba(201,164,92,0.4)',
};

const chipCoin: React.CSSProperties = {
  ...chipBase,
  color: 'var(--text2)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
};

const stepperWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const stepperBtn: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 22,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const stepperBtnDisabled: React.CSSProperties = {
  ...stepperBtn,
  cursor: 'not-allowed',
  opacity: 0.5,
};

const countInput: React.CSSProperties = {
  width: 72,
  height: 48,
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--bg)',
  textAlign: 'center',
  fontSize: 18,
  fontFamily: "'Playfair Display', serif",
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
};

const subtotalCell: React.CSSProperties = {
  textAlign: 'right',
  fontFamily: "'Playfair Display', serif",
  fontWeight: 600,
  fontSize: 18,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
};

const subtotalMuted: React.CSSProperties = {
  ...subtotalCell,
  color: 'var(--text3)',
};

export function DenominationRow(props: DenominationRowProps) {
  const { denomCentavos, count, currency, isCoin, onIncrement, onDecrement, onSetCount } =
    props;
  const t = useCashCountT();
  const subtotal = denomCentavos * count;

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    const parsed = raw === '' ? 0 : Number(raw);
    onSetCount(Math.max(0, Math.min(parsed, 9999)));
  };

  return (
    <div style={baseRow}>
      <div style={isCoin ? chipCoin : chipBill} aria-label={`Denomination ${formatCurrencyAmount(denomCentavos, currency)}`}>
        {formatCurrencyAmount(denomCentavos, currency)}
      </div>

      <div style={stepperWrap}>
        <button
          type="button"
          style={count <= 0 ? stepperBtnDisabled : stepperBtn}
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
          style={countInput}
          aria-label={t('cashCount.count')}
        />
        <button
          type="button"
          style={stepperBtn}
          onClick={onIncrement}
          aria-label={t('common.add') ?? 'Add'}
        >
          +
        </button>
      </div>

      <div style={count > 0 ? subtotalCell : subtotalMuted}>
        {formatCurrencyAmount(subtotal, currency)}
      </div>
    </div>
  );
}
