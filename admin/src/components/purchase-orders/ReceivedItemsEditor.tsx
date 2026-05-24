import { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import type { Purchase, ReceivedItemInput } from '../../types/inventory';

interface Props {
  purchase: Purchase;
  // Pre-populated when re-opening the modal so the operator's draft isn't lost.
  initial?: Record<string, ReceivedItemInput>;
  onChange: (rows: ReceivedItemInput[]) => void;
}

const SHORTFALL_REASONS = ['out_of_stock', 'damaged', 'wrong_product', 'other'] as const;

// Inline grid editor reused by ReceiveModal (delivery) + ReturnModal (errand)
// + VerifyModal (manager override). For each item the operator sets the
// actually-received package quantity and (if less than ordered) picks a
// shortfall reason. Defaults: received = ordered, except for items the
// supplier already flagged unavailable (those default to 0).
export function ReceivedItemsEditor({ purchase, initial, onChange }: Props) {
  const { t } = useTranslation();
  const items = purchase.items ?? [];

  const [rows, setRows] = useState<Record<string, ReceivedItemInput>>(() => {
    const seed: Record<string, ReceivedItemInput> = {};
    for (const it of items) {
      const fromInitial = initial?.[it.id];
      const fromBackend =
        it.received_package_quantity != null ? Number(it.received_package_quantity) : null;
      const defaultQty = it.unavailable
        ? 0
        : (fromBackend ?? Number(it.package_quantity));
      seed[it.id] = {
        id: it.id,
        received_package_quantity: fromInitial?.received_package_quantity ?? defaultQty,
        shortfall_reason: fromInitial?.shortfall_reason ?? it.shortfall_reason ?? null,
      };
    }
    return seed;
  });

  // Push the current rows up to the parent on every change. Using a derived
  // effect (not an onChange handler per field) keeps the modal's submit
  // logic dead simple.
  useEffect(() => {
    onChange(Object.values(rows));
  }, [rows, onChange]);

  function update(id: string, patch: Partial<ReceivedItemInput>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  return (
    <div className="po-receive-grid">
      <div className="po-receive-head">
        <span>{t('po.diff.item')}</span>
        <span className="num">{t('po.diff.ordered')}</span>
        <span className="num">{t('po.diff.received')}</span>
        <span>{t('po.diff.shortfallReason')}</span>
      </div>
      {items.map((it) => {
        const row = rows[it.id]!;
        const ordered = Number(it.package_quantity);
        const short = row.received_package_quantity < ordered;
        return (
          <div key={it.id} className="po-receive-row">
            <span className="po-receive-name">
              {it.supply?.name ?? it.supply_id}
              {it.packaging?.name && (
                <span className="text-muted fs-12"> · {it.packaging.name}</span>
              )}
            </span>
            <span className="num">{ordered}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={row.received_package_quantity}
              onChange={(e) =>
                update(it.id, {
                  received_package_quantity: Number(e.target.value),
                })
              }
            />
            <select
              value={row.shortfall_reason ?? ''}
              disabled={!short}
              onChange={(e) =>
                update(it.id, {
                  shortfall_reason: e.target.value === '' ? null : e.target.value,
                })
              }
            >
              <option value="">{short ? t('po.diff.pickReason') : '—'}</option>
              {SHORTFALL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`po.diff.reason.${r}`)}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
