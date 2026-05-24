// Purchase Orders tab — read-only history of POs placed with this supplier.
//
// Read-only by design (v1):
//   - Click does nothing. There's no PurchaseOrderDetailView in the terminal
//     yet; clicking would dead-end.
//   - No "+ New PO" button. Spawning the compose flow with a pre-filled
//     supplier requires plumbing a prefill param into PurchaseOrdersView;
//     the empty state points the operator there instead.
// Both are listed as non-goals in the plan; revisit when a PO detail view
// lands.

import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useTranslation } from '../../../../i18n';
import type { Supplier } from '../../../../api/suppliers';
import {
  listPurchases,
  type PurchaseDetail,
  type PurchaseStatus,
} from '../../../../api/purchases';
import { Spinner } from '../../../Spinner';
import { formatMoney } from '../../../../utils/format';

interface Props {
  supplier: Supplier;
}

export function PurchaseOrdersTab({ supplier }: Props) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['admin', 'suppliers', supplier.id, 'purchases'],
    queryFn: () => listPurchases({ supplier_id: supplier.id, status: 'ALL' }),
    staleTime: 30_000,
  });

  const rows = query.data ?? [];

  return (
    <div style={pageBody}>
      <header style={headerRow}>
        <h4 style={heading}>{t('admin.supplierDetail.orders.heading')}</h4>
      </header>

      {query.isLoading && (
        <div style={spinnerWrap}>
          <Spinner />
        </div>
      )}

      {query.error && (
        <p style={errorBanner}>{t('admin.supplierDetail.orders.failed')}</p>
      )}

      {!query.isLoading && !query.error && rows.length === 0 && (
        <div style={emptyWrap}>
          <p style={emptyTitle}>
            {t('admin.supplierDetail.orders.empty.title')}
          </p>
          <p style={emptyHint}>
            {t('admin.supplierDetail.orders.empty.subtitle')}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div style={list}>
          {rows.map((p) => (
            <PoRow key={p.id} po={p} />
          ))}
          {rows.length >= 500 && (
            <p style={truncatedHint}>
              {t('admin.supplierDetail.orders.truncated')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────

function PoRow({ po }: { po: PurchaseDetail }) {
  const { t } = useTranslation();
  const itemCount = po.items?.length ?? 0;
  const itemLabel = (
    itemCount === 1
      ? t('admin.supplierDetail.orders.itemCountOne')
      : t('admin.supplierDetail.orders.itemCount').replace(
          '{count}',
          String(itemCount),
        )
  );

  return (
    <div style={rowStyle}>
      <StatusDot status={po.status} />
      <StatusPill status={po.status} />
      <span style={dateCell}>{fmtDay(po.date)}</span>
      <span style={itemsCell}>{itemLabel}</span>
      <span style={totalCell}>{formatMoney(po.total)}</span>
    </div>
  );
}

function StatusDot({ status }: { status: PurchaseStatus }) {
  const color =
    status === 'DRAFT'
      ? 'var(--gold)'
      : status === 'CONFIRMED'
        ? 'var(--green)'
        : 'var(--text3)';
  return <span style={{ ...statusDot, background: color }} />;
}

function StatusPill({ status }: { status: PurchaseStatus }) {
  const { t } = useTranslation();
  const tint =
    status === 'DRAFT'
      ? badgeGold
      : status === 'CONFIRMED'
        ? badgeGreen
        : badgeMuted;
  const label =
    status === 'DRAFT'
      ? t('admin.purchaseOrders.status.draft')
      : status === 'CONFIRMED'
        ? t('admin.purchaseOrders.status.confirmed')
        : t('admin.purchaseOrders.status.cancelled');
  return <span style={{ ...badge, ...tint }}>{label}</span>;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Styles ────────────────────────────────────────────────────────────────

const pageBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
};

const heading: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 17,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const list: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  background: 'var(--bg2)',
};

const ROW_COLS = '14px 110px minmax(160px, 1fr) 110px 140px';

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: ROW_COLS,
  alignItems: 'center',
  gap: 14,
  padding: '14px 18px',
  borderTop: '1px solid var(--border)',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 56,
};

const dateCell: CSSProperties = {
  color: 'var(--text2)',
  letterSpacing: '0.01em',
};

const itemsCell: CSSProperties = {
  textAlign: 'right',
  color: 'var(--text2)',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
};

const totalCell: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};

const statusDot: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  display: 'inline-block',
};

const badge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  border: '1px solid',
  justifySelf: 'start',
};

const badgeGold: CSSProperties = {
  color: 'var(--gold)',
  background: 'rgba(201,164,92,0.12)',
  borderColor: 'rgba(201,164,92,0.40)',
};

const badgeGreen: CSSProperties = {
  color: 'var(--green)',
  background: 'rgba(74,140,92,0.10)',
  borderColor: 'rgba(74,140,92,0.40)',
};

const badgeMuted: CSSProperties = {
  color: 'var(--text3)',
  background: 'rgba(168,152,136,0.10)',
  borderColor: 'rgba(168,152,136,0.40)',
};

const emptyWrap: CSSProperties = {
  padding: '52px 24px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  border: '1px dashed var(--border)',
  borderRadius: 12,
  background: 'var(--bg)',
};

const emptyTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  color: 'var(--text2)',
  margin: 0,
};

const emptyHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  margin: 0,
};

const spinnerWrap: CSSProperties = {
  padding: 36,
  display: 'flex',
  justifyContent: 'center',
};

const errorBanner: CSSProperties = {
  padding: '14px 18px',
  borderRadius: 10,
  fontSize: 13,
  background: 'rgba(196,80,64,0.10)',
  color: 'var(--red)',
  border: '1px solid rgba(196,80,64,0.30)',
  margin: 0,
};

const truncatedHint: CSSProperties = {
  padding: '12px 18px',
  borderTop: '1px solid var(--border)',
  fontSize: 11,
  color: 'var(--text3)',
  textAlign: 'center',
  margin: 0,
  background: 'var(--bg)',
};
