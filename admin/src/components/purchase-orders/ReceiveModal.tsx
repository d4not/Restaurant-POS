import { useState } from 'react';
import { Modal, Button } from '../ui';
import { useReceivePurchase } from '../../hooks/usePurchases';
import { useTranslation } from '../../i18n';
import type { Purchase, ReceivedItemInput } from '../../types/inventory';
import { ReceivedItemsEditor } from './ReceivedItemsEditor';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: Purchase;
}

// IN_TRANSIT → ARRIVED: cashier captures what physically showed up. Stock
// doesn't move yet — that's manager+ verify.
export function ReceiveModal({ open, onClose, purchase }: Props) {
  const { t } = useTranslation();
  const receive = useReceivePurchase();
  const [rows, setRows] = useState<ReceivedItemInput[]>([]);

  async function submit() {
    await receive.mutateAsync({ id: purchase.id, input: { items: rows } });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('po.modal.receive.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={receive.isPending} onClick={submit}>
            {t('po.action.markArrived')}
          </Button>
        </>
      }
    >
      <p className="text-muted fs-12 mt-8" style={{ marginBottom: 12 }}>
        {t('po.modal.receive.help')}
      </p>
      <ReceivedItemsEditor purchase={purchase} onChange={setRows} />
    </Modal>
  );
}
