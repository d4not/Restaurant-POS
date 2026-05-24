import { useState } from 'react';
import { Modal, Button } from '../ui';
import { useVerifyPurchase } from '../../hooks/usePurchases';
import { useTranslation } from '../../i18n';
import type { Purchase, ReceivedItemInput } from '../../types/inventory';
import { ReceivedItemsEditor } from './ReceivedItemsEditor';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: Purchase;
}

// Manager+ approval. Optionally overrides what the cashier captured at
// receive/return. Posting triggers the stock + WAC absorb.
export function VerifyModal({ open, onClose, purchase }: Props) {
  const { t } = useTranslation();
  const verify = useVerifyPurchase();
  const [rows, setRows] = useState<ReceivedItemInput[]>([]);

  async function submit() {
    await verify.mutateAsync({
      id: purchase.id,
      input: rows.length ? { items: rows } : undefined,
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('po.modal.verify.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={verify.isPending} onClick={submit}>
            {t('po.action.verify')}
          </Button>
        </>
      }
    >
      <p className="text-muted fs-12 mt-8" style={{ marginBottom: 12 }}>
        {t('po.modal.verify.help')}
      </p>
      <ReceivedItemsEditor purchase={purchase} onChange={setRows} />
    </Modal>
  );
}
