// Two-button intermediate picker for the Cash Movement tile. Lets the
// operator pick Income / Expense without crowding the launcher with two
// near-identical tiles. Keyboard: 1 = expense, 2 = income, Esc cancels.

import { useEffect } from 'react';
import { adminStyles } from './styles';
import { IconArrowDown, IconArrowUp } from '../operations-hub/HubIcons';
import { useTranslation } from '../../i18n';

interface CashMovementPickerProps {
  open: boolean;
  onCancel: () => void;
  onPick: (kind: 'CASH_IN' | 'CASH_OUT') => void;
}

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 8,
  padding: '18px 18px 16px',
  borderRadius: 12,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  color: 'var(--text1)',
  minHeight: 124,
  transition:
    'transform 140ms cubic-bezier(0.16, 1, 0.3, 1), border-color 140ms ease, box-shadow 140ms ease',
};

const iconWrap = (color: string): React.CSSProperties => ({
  width: 36,
  height: 36,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: color,
  color: '#2c2420',
  fontSize: 18,
});

const title: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text1)',
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
};

const numberBadge: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 11,
  color: 'var(--text3)',
  marginLeft: 'auto',
};

export function CashMovementPicker({ open, onCancel, onPick }: CashMovementPickerProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === '1') {
        e.preventDefault();
        onPick('CASH_OUT');
      } else if (e.key === '2') {
        e.preventDefault();
        onPick('CASH_IN');
      }
    };
    window.addEventListener('keydown', onKey, true); // capture, so it beats the launcher
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onCancel, onPick]);

  if (!open) return null;

  return (
    <div
      style={adminStyles.pickerScrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="admin-mount-pop" style={adminStyles.pickerCard} role="dialog">
        <div style={adminStyles.pickerHead}>
          <h2 style={adminStyles.pickerTitle}>{t('admin.cashPicker.title')}</h2>
          <p style={adminStyles.pickerSub}>{t('admin.cashPicker.subtitle')}</p>
        </div>
        <div style={adminStyles.pickerGrid}>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => onPick('CASH_OUT')}
          >
            <span style={iconWrap('var(--red)')}>
              <IconArrowDown />
            </span>
            <span style={title}>{t('admin.cashPicker.expense')}</span>
            <span style={hint}>{t('admin.cashPicker.expenseHint')}</span>
            <span style={numberBadge}>1</span>
          </button>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => onPick('CASH_IN')}
          >
            <span style={iconWrap('var(--green)')}>
              <IconArrowUp />
            </span>
            <span style={title}>{t('admin.cashPicker.income')}</span>
            <span style={hint}>{t('admin.cashPicker.incomeHint')}</span>
            <span style={numberBadge}>2</span>
          </button>
        </div>
      </div>
    </div>
  );
}
