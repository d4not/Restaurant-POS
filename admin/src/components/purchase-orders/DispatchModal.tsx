import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button } from '../ui';
import { useDispatchPurchase } from '../../hooks/usePurchases';
import { listEmployees } from '../../api/employees';
import { useTranslation } from '../../i18n';
import type { Purchase } from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: Purchase;
}

// DRAFT → DISPATCHED. Cashier picks a runner + cash to entrust. Backend
// then writes a CashMovement CASH_OUT against the open shift's drawer.
// Requires an open, non-provisional shift; the backend rejects with 409 if
// not — surface that error verbatim so the operator opens a shift first.
export function DispatchModal({ open, onClose, purchase }: Props) {
  const { t } = useTranslation();
  const dispatch = useDispatchPurchase();
  const { data: employees } = useQuery({
    queryKey: ['employees', 'active'],
    queryFn: () => listEmployees({ active: true }),
    enabled: open,
  });

  // Sane suggestion: total estimated + 10% buffer, rounded up to the nearest
  // 100-cent unit so the operator hands over round bills.
  const suggested = Math.ceil((Number(purchase.total) * 1.1) / 100) * 100;
  const [runnerId, setRunnerId] = useState('');
  const [cashPesos, setCashPesos] = useState((suggested / 100).toFixed(2));
  const [reason, setReason] = useState('');

  async function submit() {
    await dispatch.mutateAsync({
      id: purchase.id,
      input: {
        runner_user_id: runnerId,
        cash_advanced: Math.round(Number(cashPesos) * 100),
        reason: reason.trim() === '' ? undefined : reason.trim(),
      },
    });
    onClose();
  }

  const canSubmit = runnerId && Number(cashPesos) > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('po.modal.dispatch.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={dispatch.isPending}
            onClick={submit}
            disabled={!canSubmit}
          >
            {t('po.action.dispatch')}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>{t('po.field.runner')}</label>
        <select value={runnerId} onChange={(e) => setRunnerId(e.target.value)}>
          <option value="">{t('common.pickOne')}</option>
          {employees?.items.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>{t('po.field.cashAdvanced')}</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={cashPesos}
          onChange={(e) => setCashPesos(e.target.value)}
        />
        <small className="text-muted">{t('po.modal.dispatch.suggested')}</small>
      </div>
      <div className="field">
        <label>{t('po.field.reasonOptional')}</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={120}
        />
      </div>
    </Modal>
  );
}
