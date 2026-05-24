import { useState } from 'react';
import { Modal, Button } from '../ui';
import { useReplyPurchase } from '../../hooks/usePurchases';
import { useTranslation } from '../../i18n';
import type { Purchase } from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: Purchase;
}

// Captures the supplier's verbal/text reply: confirmed subtotal, shipping
// cost, and per-item availability. Posting flips DRAFT→SENT→REPLIED
// (assumes you came in from SENT). Unavailable items don't absorb stock at
// verify, so this is the time to mark them.
export function ReplyModal({ open, onClose, purchase }: Props) {
  const { t } = useTranslation();
  const reply = useReplyPurchase();
  const [subtotalPesos, setSubtotalPesos] = useState('');
  const [shippingPesos, setShippingPesos] = useState('');
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());

  function toggleUnavailable(id: string) {
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    await reply.mutateAsync({
      id: purchase.id,
      input: {
        supplier_subtotal:
          subtotalPesos.trim() === '' ? null : Math.round(Number(subtotalPesos) * 100),
        shipping_cost:
          shippingPesos.trim() === '' ? null : Math.round(Number(shippingPesos) * 100),
        items: Array.from(unavailable).map((id) => ({ id, unavailable: true })),
      },
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('po.modal.reply.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={reply.isPending} onClick={submit}>
            {t('po.action.reply')}
          </Button>
        </>
      }
    >
      <div className="section-grid-2">
        <div className="field">
          <label>{t('po.field.supplierSubtotal')}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={subtotalPesos}
            onChange={(e) => setSubtotalPesos(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="field">
          <label>{t('po.field.shippingCost')}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={shippingPesos}
            onChange={(e) => setShippingPesos(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="field">
        <label>{t('po.modal.reply.itemsLabel')}</label>
        <ul className="po-reply-items">
          {(purchase.items ?? []).map((it) => (
            <li key={it.id}>
              <label className="po-reply-item-row">
                <input
                  type="checkbox"
                  checked={unavailable.has(it.id) || it.unavailable}
                  onChange={() => toggleUnavailable(it.id)}
                />
                <span className="po-reply-item-name">
                  {it.package_quantity}× {it.supply?.name ?? it.supply_id}
                </span>
                <span className="text-muted fs-12">
                  {unavailable.has(it.id) || it.unavailable
                    ? t('po.modal.reply.markedUnavailable')
                    : ''}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
