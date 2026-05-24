// Supply Info → Consumers section.
//
// Reads /api/v1/supplies/:id/consuming-products. Lists the products (and
// variants) whose recipes consume this supply, one row per recipe-line — so
// a "double shot" product with two slots for the same supply shows up twice.
//
// Not paginated: a supply is rarely in more than ~50 recipes. Inactive
// products are rendered dimmed but still listed so the operator can spot
// stale references that should be cleaned up.

import { type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import type { TranslationKey } from '../../../i18n/en';
import { api } from '../../../api/client';

// ─── Types ──────────────────────────────────────────────────────────────────

type ProductType = 'PRODUCT' | 'DISH' | 'PREPARATION';

interface ConsumerRow {
  recipe_item_id: string;
  recipe_id: string;
  product_id: string;
  product_name: string;
  product_type: ProductType;
  product_active: boolean;
  variant_id: string | null;
  variant_name: string | null;
  variant_active: boolean | null;
  quantity: string;
  unit: string;
  waste_pct: string;
}

interface ListResponse {
  items: ConsumerRow[];
}

interface Props {
  supplyId: string;
}

// ─── Data fetcher ───────────────────────────────────────────────────────────

async function fetchConsumers(supplyId: string): Promise<ConsumerRow[]> {
  const res = await api.get<ListResponse>(
    `/supplies/${supplyId}/consuming-products`,
  );
  return res.items;
}

// ─── Display helpers ────────────────────────────────────────────────────────

function typeKey(type: ProductType): TranslationKey {
  return `admin.supplyInfo.consumers.type.${type}` as TranslationKey;
}

function formatWaste(pct: string): string {
  const dec = new Decimal(pct);
  if (dec.isZero()) return '—';
  // waste_pct in the DB is stored as a fraction (0.05 = 5%), but check both:
  // values >= 1 are likely percentages already.
  const display = dec.gte(1) ? dec : dec.mul(100);
  return `${display.toDecimalPlaces(1).toString()}%`;
}

function formatQty(quantity: string, unit: string): string {
  return `${new Decimal(quantity).toDecimalPlaces(3).toString()} ${unit.toLowerCase()}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplyConsumersSection({ supplyId }: Props) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'consumers'],
    queryFn: () => fetchConsumers(supplyId),
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
    return <p style={errorBanner}>{t('admin.supplyInfo.consumers.failed')}</p>;
  }

  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <p style={emptyHint}>{t('admin.supplyInfo.consumers.empty')}</p>;
  }

  return (
    <div style={tableShell}>
      <div style={tableHead}>
        <span>{t('admin.supplyInfo.consumers.col.product')}</span>
        <span>{t('admin.supplyInfo.consumers.col.variant')}</span>
        <span style={cellRight}>{t('admin.supplyInfo.consumers.col.quantity')}</span>
        <span style={cellRight}>{t('admin.supplyInfo.consumers.col.waste')}</span>
      </div>

      {rows.map((row) => {
        const inactive =
          !row.product_active || (row.variant_id !== null && row.variant_active === false);
        return (
          <div
            key={row.recipe_item_id}
            style={{
              ...tableRow,
              ...(inactive ? rowInactive : {}),
            }}
          >
            <span style={productCell}>
              <span style={productNameStyle}>{row.product_name}</span>
              <span style={productMetaRow}>
                <span style={productType}>{t(typeKey(row.product_type))}</span>
                {inactive && (
                  <span style={inactiveBadge}>
                    {t('admin.supplyInfo.consumers.inactive')}
                  </span>
                )}
              </span>
            </span>
            <span style={variantCell}>
              {row.variant_name ?? t('admin.supplyInfo.consumers.noVariant')}
            </span>
            <span style={{ ...cellRight, ...cellNum }}>
              {formatQty(row.quantity, row.unit)}
            </span>
            <span style={{ ...cellRight, ...cellNumMuted }}>
              {formatWaste(row.waste_pct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const COLS = 'minmax(180px, 2fr) minmax(120px, 1fr) 130px 90px';

const tableShell: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  overflow: 'hidden',
};

const tableHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLS,
  gap: 14,
  padding: '10px 16px',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg2)',
  borderBottom: '1px solid var(--border)',
};

const tableRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLS,
  gap: 14,
  alignItems: 'center',
  padding: '12px 16px',
  borderTop: '1px solid var(--border)',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 44,
};

const rowInactive: CSSProperties = {
  opacity: 0.6,
};

const productCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
};

const productNameStyle: CSSProperties = {
  fontWeight: 600,
  color: 'var(--text1)',
  fontSize: 13.5,
};

const productMetaRow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const productType: CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const variantCell: CSSProperties = {
  color: 'var(--text2)',
  fontSize: 13,
};

const cellRight: CSSProperties = {
  textAlign: 'right',
};

const cellNum: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFamily: "'Playfair Display', serif",
  fontSize: 14,
  fontWeight: 600,
};

const cellNumMuted: CSSProperties = {
  ...cellNum,
  fontWeight: 500,
  color: 'var(--text2)',
};

const inactiveBadge: CSSProperties = {
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
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
