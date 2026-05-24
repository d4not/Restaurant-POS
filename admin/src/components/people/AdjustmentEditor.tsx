import { useState } from 'react';
import { Badge, Button } from '../ui';
import type {
  PayrollAdjustment,
  PayrollAdjustmentType,
} from '../../types/people';
import type { PayrollStatus } from '../../types/staff';
import { amountToCentavos, formatMoney } from '../../utils/format';
import { useAddAdjustment, useRemoveAdjustment } from '../../hooks/usePayroll';
import { useTranslation } from '../../i18n';

interface Props {
  periodId: string;
  adjustments: PayrollAdjustment[];
  status: PayrollStatus;
  onMutate?: () => void;
}

export function AdjustmentEditor({
  periodId,
  adjustments,
  status,
  onMutate,
}: Props) {
  const { t } = useTranslation();
  const addM = useAddAdjustment();
  const removeM = useRemoveAdjustment();

  const [type, setType] = useState<PayrollAdjustmentType>('BONUS');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const editable = status === 'DRAFT';

  const submit = async () => {
    setError(null);
    const cents = amountToCentavos(amount);
    if (!label.trim()) {
      setError('Label is required');
      return;
    }
    if (cents === null || cents <= 0) {
      setError('Amount must be a positive number');
      return;
    }
    try {
      await addM.mutateAsync({
        periodId,
        input: { type, label: label.trim(), amount: cents },
      });
      setLabel('');
      setAmount('');
      onMutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add adjustment');
    }
  };

  const onRemove = async (adj: PayrollAdjustment) => {
    if (!editable) return;
    if (!window.confirm(t('people.payroll.adjustments.removeConfirm'))) return;
    setError(null);
    try {
      await removeM.mutateAsync({ periodId, adjustmentId: adj.id });
      onMutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove adjustment');
    }
  };

  return (
    <div>
      <h3 style={{ marginBottom: 8 }}>{t('people.payroll.adjustments.title')}</h3>

      {adjustments.length === 0 && (
        <div
          style={{
            padding: '14px 16px',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text3)',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {t('common.noResults')}
        </div>
      )}

      {adjustments.length > 0 && (
        <div
          className="table-wrap"
          style={{ marginBottom: 12 }}
        >
          <div
            className="table-head"
            style={{ gridTemplateColumns: '110px 1fr 140px 130px 60px', columnGap: 8 }}
          >
            <div>{t('common.type')}</div>
            <div>{t('common.name')}</div>
            <div>{t('common.amount')}</div>
            <div>{t('common.notes')}</div>
            <div />
          </div>
          {adjustments.map((adj, idx) => {
            const isTips = adj.source_kind === 'TIPS';
            const sign = adj.type === 'BONUS' ? '+' : '−';
            const tone =
              isTips ? 'gold' :
              adj.type === 'BONUS' ? 'green' : 'red';
            return (
              <div
                key={adj.id}
                className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
                style={{
                  gridTemplateColumns: '110px 1fr 140px 130px 60px',
                  columnGap: 8,
                  cursor: 'default',
                }}
              >
                <div>
                  <Badge tone={tone}>
                    {isTips
                      ? t('people.payroll.adjustments.tipsLocked')
                      : adj.type === 'BONUS'
                        ? t('people.payroll.adjustments.bonus')
                        : t('people.payroll.adjustments.deduction')}
                  </Badge>
                </div>
                <div className="fs-13">{adj.label}</div>
                <div
                  className="fw-600 fs-13"
                  style={{
                    color:
                      adj.type === 'BONUS' ? 'var(--green)' : 'var(--red)',
                  }}
                >
                  {sign}{formatMoney(Number(adj.amount))}
                </div>
                <div className="fs-11 text-muted">
                  {adj.creator?.name ?? '—'}
                </div>
                <div>
                  {!isTips && editable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemove(adj)}
                      loading={removeM.isPending}
                      aria-label="Remove"
                    >
                      ×
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editable && (
        <div
          style={{
            padding: 12,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg)',
            display: 'grid',
            gridTemplateColumns: '140px 1fr 160px auto',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="adj-type">{t('common.type')}</label>
            <select
              id="adj-type"
              value={type}
              onChange={(e) => setType(e.target.value as PayrollAdjustmentType)}
            >
              <option value="BONUS">{t('people.payroll.adjustments.bonus')}</option>
              <option value="DEDUCTION">
                {t('people.payroll.adjustments.deduction')}
              </option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="adj-label">
              {t('people.payroll.adjustments.addLabel')}
            </label>
            <input
              id="adj-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={160}
              placeholder={t('common.description')}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="adj-amount">
              {t('people.payroll.adjustments.addAmount')}
            </label>
            <input
              id="adj-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <Button
            variant="primary"
            onClick={submit}
            loading={addM.isPending}
            disabled={!label.trim() || !amount}
          >
            + {t('people.payroll.adjustments.add')}
          </Button>
        </div>
      )}

      {error && (
        <div className="auth-alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}
