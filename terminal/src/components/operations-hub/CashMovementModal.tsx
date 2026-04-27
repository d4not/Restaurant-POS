import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCashMovement, type CashMovementType } from '../../api/cash-movements';
import { ApiError } from '../../api/client';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';

interface CashMovementModalProps {
  open: boolean;
  kind: CashMovementType;
  registerId: string | null;
  onClose: () => void;
}

function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function CashMovementModal({ open, kind, registerId, onClose }: CashMovementModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmountInput('');
    setReason('');
    setError(null);
  }, [open, kind]);

  const mutation = useMutation({
    mutationFn: ({ amount, reason }: { amount: number; reason: string }) => {
      if (!registerId) throw new Error('No register');
      return createCashMovement(registerId, { type: kind, amount, reason });
    },
    onSuccess: async () => {
      // Invalidate any daily report or register-related cache so totals reflect
      // the new movement immediately when the cashier opens the report next.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['register'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-summary'] }),
      ]);
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('cashMovement.failed')),
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, amountInput, reason, registerId, kind]);

  if (!open) return null;

  function submit() {
    setError(null);
    const amt = parseAmount(amountInput);
    if (amt == null) {
      setError(t('cashMovement.amountError'));
      return;
    }
    if (reason.trim().length === 0) {
      setError(t('cashMovement.reasonError'));
      return;
    }
    mutation.mutate({ amount: amt, reason: reason.trim() });
  }

  const isExpense = kind === 'CASH_OUT';

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div style={hubStyles.childModal} onClick={(e) => e.stopPropagation()} role="dialog">
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>
            {isExpense ? t('cashMovement.expenseTitle') : t('cashMovement.incomeTitle')}
          </h2>
          <div style={hubStyles.sub}>
            {isExpense ? t('cashMovement.expenseSub') : t('cashMovement.incomeSub')}
          </div>
        </div>

        <div style={hubStyles.body}>
          <div style={hubStyles.field}>
            <label style={hubStyles.label}>{t('cashMovement.amount')} (MXN)</label>
            <input
              autoFocus
              inputMode="decimal"
              style={hubStyles.input}
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
            <span style={hubStyles.hint}>{t('cashMovement.amountHint')}</span>
          </div>
          <div style={hubStyles.field}>
            <label style={hubStyles.label}>{t('cashMovement.reason')}</label>
            <textarea
              style={hubStyles.textarea}
              placeholder={t('cashMovement.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
          {error && <div style={hubStyles.errBanner}>{error}</div>}
        </div>

        <div style={hubStyles.actions}>
          <button type="button" style={hubStyles.cancelBtn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={hubStyles.primaryBtn}
            onClick={submit}
            disabled={mutation.isPending || !registerId}
          >
            {mutation.isPending && <Spinner size={12} />}
            {isExpense ? t('cashMovement.submitExpense') : t('cashMovement.submitIncome')}
          </button>
        </div>
      </div>
    </div>
  );
}
