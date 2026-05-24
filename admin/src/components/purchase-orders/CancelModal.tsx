import { useState } from 'react';
import { Modal, Button } from '../ui';
import { useCancelPurchase, useRejectPurchase } from '../../hooks/usePurchases';
import { useTranslation } from '../../i18n';
import type { Purchase } from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: Purchase;
  // 'reject' is the dedicated delivery-mid-flight terminal state (supplier
  // said no); everything else uses /cancel.
  variant: 'cancel' | 'reject';
}

export function CancelModal({ open, onClose, purchase, variant }: Props) {
  const { t } = useTranslation();
  const cancel = useCancelPurchase();
  const reject = useRejectPurchase();
  const [reason, setReason] = useState('');

  const isPending = variant === 'reject' ? reject.isPending : cancel.isPending;

  async function submit() {
    if (variant === 'reject') {
      await reject.mutateAsync({ id: purchase.id, input: { cancel_reason: reason } });
    } else {
      await cancel.mutateAsync({ id: purchase.id, input: { cancel_reason: reason } });
    }
    setReason('');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={variant === 'reject' ? t('po.modal.reject.title') : t('po.modal.cancel.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.back')}
          </Button>
          <Button
            variant="danger"
            loading={isPending}
            onClick={submit}
            disabled={reason.trim().length < 5}
          >
            {variant === 'reject' ? t('po.action.reject') : t('po.action.cancel')}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>{t('po.field.cancelReason')}</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={t('po.field.cancelReasonPlaceholder')}
        />
        <small className="text-muted">{t('po.field.cancelReasonHint')}</small>
      </div>
    </Modal>
  );
}
