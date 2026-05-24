import { useState } from 'react';
import { Modal, Button } from '../ui';
import { useMarkInTransit } from '../../hooks/usePurchases';
import { useTranslation } from '../../i18n';
import type { Purchase } from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: Purchase;
}

export function InTransitModal({ open, onClose, purchase }: Props) {
  const { t } = useTranslation();
  const m = useMarkInTransit();
  const [expected, setExpected] = useState(
    purchase.expected_arrival ? purchase.expected_arrival.slice(0, 10) : '',
  );

  async function submit() {
    await m.mutateAsync({
      id: purchase.id,
      input: { expected_arrival: expected ? new Date(expected).toISOString() : null },
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('po.modal.inTransit.title')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            {t('po.action.markInTransit')}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>{t('po.field.expectedArrival')}</label>
        <input
          type="date"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
        />
      </div>
    </Modal>
  );
}
