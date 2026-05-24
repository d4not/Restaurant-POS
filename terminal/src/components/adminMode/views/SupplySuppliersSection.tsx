// Supply Info → Suppliers section.
//
// Reads /api/v1/supplies/:id/suppliers (not paginated — small set). The
// backend aggregates PurchaseItem rows by supplier and pre-sorts: primary
// first, then most-recent, then highest spend. We render that order verbatim
// so the visual hierarchy stays predictable.
//
// The "primary" badge comes from PurchasePackaging.is_primary regardless of
// whether any purchases landed yet, so a freshly-marked primary still shows
// here as a stub with zeroed stats.

import { type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import { api } from '../../../api/client';
import { formatMoneyPlain } from '../../../utils/format';

// ─── Types ──────────────────────────────────────────────────────────────────

type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';

interface SupplierAggRow {
  supplier_id: string;
  name: string;
  contact_name: string | null;
  active: boolean;
  is_primary: boolean;
  last_purchase_date: string | null;
  last_unit_cost: string | null;
  total_base_quantity: string;
  total_spend_cents: string;
  purchase_count: number;
}

interface ListResponse {
  items: SupplierAggRow[];
}

interface Props {
  supplyId: string;
  baseUnit: BaseUnit;
}

// ─── Data fetcher ───────────────────────────────────────────────────────────

async function fetchSuppliers(supplyId: string): Promise<SupplierAggRow[]> {
  const res = await api.get<ListResponse>(`/supplies/${supplyId}/suppliers`);
  return res.items;
}

// ─── Display helpers ────────────────────────────────────────────────────────

const UNIT_LABEL_SHORT: Record<BaseUnit, string> = {
  PIECE: 'pc',
  BOTTLE: 'btl',
  KG: 'kg',
  LITER: 'L',
  BAG: 'bag',
  BOX: 'box',
  UNIT: 'un',
};

function formatQty(value: string, unit: BaseUnit): string {
  return `${new Decimal(value).toDecimalPlaces(2).toString()} ${
    UNIT_LABEL_SHORT[unit] ?? unit.toLowerCase()
  }`;
}

function formatRelativeDate(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplySuppliersSection({ supplyId, baseUnit }: Props) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'suppliers'],
    queryFn: () => fetchSuppliers(supplyId),
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div style={loaderWrap}>
        <Spinner />
      </div>
    );
  }

  if (query.error) {
    return <p style={errorBanner}>{t('admin.supplyInfo.suppliers.failed')}</p>;
  }

  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <p style={emptyHint}>{t('admin.supplyInfo.suppliers.empty')}</p>;
  }

  return (
    <div style={cardGrid}>
      {rows.map((row) => {
        const noPurchases = row.purchase_count === 0;
        return (
          <article key={row.supplier_id} style={row.is_primary ? cardPrimary : card}>
            <header style={cardHead}>
              <div style={cardNameBlock}>
                <h4
                  style={{
                    ...cardName,
                    ...(row.active ? {} : { color: 'var(--text2)' }),
                  }}
                >
                  {row.name}
                </h4>
                {row.contact_name && (
                  <span style={cardContact}>{row.contact_name}</span>
                )}
              </div>
              <div style={cardBadgeRow}>
                {row.is_primary && (
                  <span style={primaryBadge}>
                    {t('admin.supplyInfo.suppliers.primary')}
                  </span>
                )}
                {!row.active && (
                  <span style={inactiveBadge}>
                    {t('admin.supplyInfo.suppliers.inactive')}
                  </span>
                )}
              </div>
            </header>

            {noPurchases ? (
              <p style={neverHint}>{t('admin.supplyInfo.suppliers.never')}</p>
            ) : (
              <div style={statGrid}>
                <Stat
                  label={t('admin.supplyInfo.suppliers.stat.lastPurchase')}
                  value={formatRelativeDate(
                    row.last_purchase_date,
                    t('admin.supplyInfo.suppliers.never'),
                  )}
                />
                <Stat
                  label={t('admin.supplyInfo.suppliers.stat.lastUnitCost')}
                  value={row.last_unit_cost ? formatMoneyPlain(row.last_unit_cost) : '—'}
                />
                <Stat
                  label={t('admin.supplyInfo.suppliers.stat.totalQty')}
                  value={formatQty(row.total_base_quantity, baseUnit)}
                />
                <Stat
                  label={t('admin.supplyInfo.suppliers.stat.totalSpend')}
                  value={formatMoneyPlain(row.total_spend_cents)}
                />
                <Stat
                  label={t('admin.supplyInfo.suppliers.stat.purchaseCount')}
                  value={String(row.purchase_count)}
                />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

interface StatProps {
  label: string;
  value: string;
}
function Stat({ label, value }: StatProps) {
  return (
    <div style={statCell}>
      <span style={statLabel}>{label}</span>
      <span style={statValue}>{value}</span>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const cardGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
};

const card: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--bg)',
  padding: '16px 18px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const cardPrimary: CSSProperties = {
  ...card,
  borderColor: 'rgba(201,164,92,0.45)',
  background: 'rgba(201,164,92,0.04)',
};

const cardHead: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 10,
};

const cardNameBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  flex: 1,
};

const cardName: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
  letterSpacing: '-0.005em',
};

const cardContact: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
};

const cardBadgeRow: CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  flexShrink: 0,
};

const primaryBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  background: 'rgba(201,164,92,0.16)',
  color: '#7a5a1f',
  border: '1px solid rgba(201,164,92,0.40)',
};

const inactiveBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const statGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
  gap: 10,
};

const statCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const statLabel: CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const statValue: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
};

const neverHint: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontStyle: 'italic',
  margin: 0,
};

const emptyHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  padding: '14px 16px',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  margin: 0,
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

const loaderWrap: CSSProperties = {
  padding: 32,
  display: 'flex',
  justifyContent: 'center',
};
