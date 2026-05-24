import { useState } from 'react';
import { Modal, Button } from '../ui';
import { useReturnPurchase } from '../../hooks/usePurchases';
import { useTranslation } from '../../i18n';
import type { Purchase, ReceivedItemInput } from '../../types/inventory';
import { ReceivedItemsEditor } from './ReceivedItemsEditor';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: Purchase;
}

// DISPATCHED → RETURNED. Cashier records what the runner brought back
// (items + cash change). Stock is still not absorbed — manager+ verifies.
export function ReturnModal({ open, onClose, purchase }: Props) {
  const { t } = useTranslation();
  const ret = useReturnPurchase();
  const advanced = Number(purchase.cash_advanced ?? 0);
  const [changePesos, setChangePesos] = useState('0.00');
  const [rows, setRows] = useState<ReceivedItemInput[]>([]);
  const [reason, setReason] = useState('');

  async function submit() {
    await ret.mutateAsync({
      id: purchase.id,
      input: {
        cash_returned: Math.round(Number(changePesos) * 100),
        items: rows,
        reason: reason.trim() === '' ? undefined : reason.trim(),
      },
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('po.modal.return.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={ret.isPending} onClick={submit}>
            {t('po.action.markReturned')}
          </Button>
        </>
      }
    >
      <div className="po-return-cash-summary">
        <span>{t('po.modal.return.advanced')}</span>
        <strong>${(advanced / 100).toFixed(2)}</strong>
      </div>
      <div className="field">
        <label>{t('po.field.cashReturned')}</label>
        <input
          type="number"
          min="0"
          max={(advanced / 100).toFixed(2)}
          step="0.01"
          value={changePesos}
          onChange={(e) => setChangePesos(e.target.value)}
        />
        <small className="text-muted">{t('po.modal.return.cashHint')}</small>
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
      <ReceivedItemsEditor purchase={purchase} onChange={setRows} />
    </Modal>
  );
}
