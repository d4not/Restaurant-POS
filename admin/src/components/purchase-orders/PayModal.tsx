import { useState } from 'react';
import { Modal, Button } from '../ui';
import { usePayPurchase } from '../../hooks/usePurchases';
import { useTranslation } from '../../i18n';
import type { Purchase } from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: Purchase;
}

// SUPPLIER_REPLIED → PAID. Payment to a digital supplier is bank-side, so
// we only capture a reference (transfer ID, deposit slip, etc.) — no
// CashMovement happens.
export function PayModal({ open, onClose, purchase }: Props) {
  const { t } = useTranslation();
  const pay = usePayPurchase();
  const [ref, setRef] = useState('');

  async function submit() {
    await pay.mutateAsync({
      id: purchase.id,
      input: { payment_reference: ref.trim() === '' ? null : ref.trim() },
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('po.modal.pay.title')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={pay.isPending} onClick={submit}>
            {t('po.action.markPaid')}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>{t('po.field.paymentReference')}</label>
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder={t('po.field.paymentReferencePlaceholder')}
          maxLength={120}
        />
      </div>
    </Modal>
  );
}
