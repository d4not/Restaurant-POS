import type { Purchase, PurchaseItem } from '../../types/inventory';
import { formatMoney } from '../../utils/format';
import { useTranslation } from '../../i18n';

interface Props {
  purchase: Purchase;
}

// Returns the effective "received" quantity for display. Until the lifecycle
// reaches the receive step (ARRIVED for delivery / RETURNED for errand) the
// value is null — show "—" so the operator sees they still owe an entry.
// Past that point, fall back to ordered for older rows that legacy-pathed
// through /confirm.
function effectiveReceived(item: PurchaseItem, purchase: Purchase): string | null {
  if (item.received_package_quantity != null) {
    return item.received_package_quantity;
  }
  const reached = ['ARRIVED', 'RETURNED', 'VERIFIED', 'CONFIRMED'].includes(purchase.status);
  if (reached) {
    return item.package_quantity;
  }
  return null;
}

function lineMoney(pkgQty: string, pricePerPkg: string): number {
  return Math.round(Number(pkgQty) * Number(pricePerPkg));
}

export function DiffTable({ purchase }: Props) {
  const { t } = useTranslation();
  const items = purchase.items ?? [];
  if (items.length === 0) {
    return <div className="empty-state">{t('po.diff.empty')}</div>;
  }

  return (
    <div className="po-diff-table" role="table" aria-label={t('po.diff.tableLabel')}>
      <div className="po-diff-head" role="row">
        <span role="columnheader">{t('po.diff.item')}</span>
        <span role="columnheader" className="num">{t('po.diff.ordered')}</span>
        <span role="columnheader" className="num">{t('po.diff.received')}</span>
        <span role="columnheader" className="num">{t('po.diff.delta')}</span>
        <span role="columnheader" className="num">{t('po.diff.unitPrice')}</span>
        <span role="columnheader" className="num">{t('po.diff.lineTotal')}</span>
      </div>
      {items.map((item) => {
        const received = effectiveReceived(item, purchase);
        const ordered = item.package_quantity;
        const delta = received != null ? Number(received) - Number(ordered) : null;
        const total = lineMoney(ordered, item.price_per_package);
        const deltaTone = delta == null ? '' : delta < 0 ? 'text-red' : delta > 0 ? 'text-gold' : 'text-muted';
        return (
          <div key={item.id} className="po-diff-row" role="row">
            <span className="po-diff-name" role="cell">
              {item.supply?.name ?? item.supply_id}
              {item.unavailable && (
                <span className="badge badge-red" style={{ marginLeft: 8 }}>
                  {t('po.diff.unavailable')}
                </span>
              )}
              {item.packaging?.name && (
                <span className="text-muted fs-12" style={{ marginLeft: 6 }}>
                  · {item.packaging.name}
                </span>
              )}
              {item.shortfall_reason && (
                <div className="text-muted fs-12">{item.shortfall_reason}</div>
              )}
            </span>
            <span className="num" role="cell">{ordered}</span>
            <span className="num" role="cell">{received ?? '—'}</span>
            <span className={`num ${deltaTone}`} role="cell">
              {delta == null ? '—' : delta > 0 ? `+${delta}` : delta}
            </span>
            <span className="num" role="cell">{formatMoney(item.price_per_package)}</span>
            <span className="num" role="cell">{formatMoney(total)}</span>
          </div>
        );
      })}
    </div>
  );
}
