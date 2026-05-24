// Catalog · Products — list + dispatcher.
//
// The list itself (KPI strip + filter toolbar + table) is what the user lands
// on; tapping a row pushes ProductDetailView for full-parity editing of
// variants, modifier groups, modifications and the recipe. The "+ New"
// header action pushes ProductNewView, the two-step wizard.
//
// Backend touch points
//   GET    /api/v1/products                    — paginated catalog
//   GET    /api/v1/product-categories          — filter dropdown
//   (CRUD lives in ProductDetailView / ProductNewView)

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import {
  listProductsAdmin,
  type PosProduct,
  type ProductType,
  type ProductVariant,
} from '../../../api/products';
import {
  listProductCategories,
  type ProductCategory,
} from '../../../api/product-categories';
import { formatMoneyPlain } from '../../../utils/format';
import {
  productTypeBadgeStyle,
  productTypeLabel,
} from '../../../utils/product-meta';
import { ProductDetailView } from './ProductDetailView';
import { ProductNewView } from './ProductNewView';

const PRODUCT_TYPES: ProductType[] = ['PRODUCT', 'DISH', 'PREPARATION'];

type StatusFilter = 'ACTIVE' | 'ALL' | 'INACTIVE';
type TypeFilter = 'ALL' | ProductType;

type SubView =
  | { kind: 'list' }
  | { kind: 'detail'; productId: string }
  | { kind: 'new' };

interface Props {
  onBack: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

function lowestVariantPrice(variants: ProductVariant[]): number | null {
  let lo: number | null = null;
  for (const v of variants) {
    if (!v.active) continue;
    const n = Number(v.sell_price);
    if (!Number.isFinite(n)) continue;
    if (lo === null || n < lo) lo = n;
  }
  return lo;
}

function priceLine(p: PosProduct): { label: string; cents: number | null } {
  if (p.type === 'PREPARATION') return { label: '—', cents: null };
  const direct = p.sell_price ? Number(p.sell_price) : NaN;
  if (Number.isFinite(direct) && direct > 0) {
    return { label: formatMoneyPlain(direct), cents: direct };
  }
  const lo = lowestVariantPrice(p.variants);
  if (lo !== null) {
    return { label: `${formatMoneyPlain(lo)}+`, cents: lo };
  }
  return { label: '—', cents: null };
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function ProductsListView({ onBack }: Props) {
  const [subView, setSubView] = useState<SubView>({ kind: 'list' });
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  if (subView.kind === 'detail') {
    return (
      <>
        <ProductDetailView
          productId={subView.productId}
          onBack={() => setSubView({ kind: 'list' })}
          onSaved={(text) => setToast({ kind: 'ok', text })}
          onError={(text) => setToast({ kind: 'err', text })}
        />
        {toast && <Toast kind={toast.kind} text={toast.text} />}
      </>
    );
  }

  if (subView.kind === 'new') {
    return (
      <>
        <ProductNewView
          onBack={() => setSubView({ kind: 'list' })}
          onCreated={(id, msg) => {
            setToast({ kind: 'ok', text: msg });
            setSubView({ kind: 'detail', productId: id });
          }}
          onError={(text) => setToast({ kind: 'err', text })}
        />
        {toast && <Toast kind={toast.kind} text={toast.text} />}
      </>
    );
  }

  return (
    <>
      <ProductsList
        onBack={onBack}
        onOpen={(id) => setSubView({ kind: 'detail', productId: id })}
        onNew={() => setSubView({ kind: 'new' })}
      />
      {toast && <Toast kind={toast.kind} text={toast.text} />}
    </>
  );
}

/* ── List screen ────────────────────────────────────────────────────────── */

interface ListProps {
  onBack: () => void;
  onOpen: (productId: string) => void;
  onNew: () => void;
}

function ProductsList({ onBack, onOpen, onNew }: ListProps) {
  const { t } = useTranslation();

  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');

  const productsQuery = useQuery({
    queryKey: ['admin', 'products', { includeInactive: status !== 'ACTIVE' }],
    queryFn: () => listProductsAdmin({ includeInactive: status !== 'ACTIVE' }),
    staleTime: 30_000,
  });

  const categoriesQuery = useQuery<ProductCategory[]>({
    queryKey: ['admin', 'productCategories'],
    queryFn: listProductCategories,
    staleTime: 5 * 60_000,
  });

  const allRows = productsQuery.data ?? [];

  const filteredByStatus = useMemo(() => {
    if (status === 'ALL') return allRows;
    if (status === 'ACTIVE') return allRows.filter((p) => p.active);
    return allRows.filter((p) => !p.active);
  }, [allRows, status]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filteredByStatus.filter((p) => {
      if (typeFilter !== 'ALL' && p.type !== typeFilter) return false;
      if (categoryId !== 'ALL' && p.category_id !== categoryId) return false;
      if (q) {
        const hay = `${p.name} ${p.barcode ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [filteredByStatus, search, categoryId, typeFilter]);

  // KPI metrics — derived from the full fetched catalog, not the filtered set.
  const kpis = useMemo(() => {
    const active = allRows.filter((p) => p.active);
    const inactive = allRows.length - active.length;
    let dishes = 0;
    let noPrice = 0;
    for (const p of active) {
      if (p.type === 'DISH') dishes += 1;
      if (p.type === 'PREPARATION') continue;
      const { cents } = priceLine(p);
      if (cents === null) noPrice += 1;
    }
    return { tracked: active.length, dishes, noPrice, inactive };
  }, [allRows]);

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categoriesQuery.data ?? []) m.set(c.id, c.name);
    return m;
  }, [categoriesQuery.data]);

  const isLoading = productsQuery.isLoading || categoriesQuery.isLoading;

  const countLabel =
    filtered.length === 1
      ? t('admin.productsList.count.shownOne')
      : interpolate(t('admin.productsList.count.shown'), { count: filtered.length });

  return (
    <AdminViewShell
      titleKey="admin.productsList.title"
      subtitleKey="admin.productsList.subtitle"
      onBack={onBack}
      headerActions={
        <span style={headerActions}>
          <span style={countPill} aria-live="polite">
            {countLabel}
          </span>
          <button type="button" style={btnPrimary} onClick={onNew}>
            {t('admin.productsList.newBtn')}
          </button>
        </span>
      }
    >
      {/* KPI strip */}
      <div style={kpiGrid}>
        <KpiCell
          label={t('admin.productsList.kpi.tracked')}
          value={String(kpis.tracked)}
          hint={t('admin.productsList.kpi.trackedHint')}
        />
        <KpiCell
          label={t('admin.productsList.kpi.dishes')}
          value={String(kpis.dishes)}
          hint={t('admin.productsList.kpi.dishesHint')}
        />
        <KpiCell
          label={t('admin.productsList.kpi.noPrice')}
          value={String(kpis.noPrice)}
          hint={t('admin.productsList.kpi.noPriceHint')}
          valueColor={kpis.noPrice > 0 ? 'var(--red)' : undefined}
        />
        <KpiCell
          label={t('admin.productsList.kpi.inactive')}
          value={String(kpis.inactive)}
          hint={t('admin.productsList.kpi.inactiveHint')}
          muted
        />
      </div>

      {/* Filter toolbar */}
      <div style={filterBar}>
        <label style={{ ...filterField, flex: 1, minWidth: 240 }}>
          <span style={filterLabel}>{t('admin.productsList.filter.search')}</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.productsList.filter.searchPlaceholder')}
            style={textInput}
          />
        </label>

        <label style={filterField}>
          <span style={filterLabel}>{t('admin.productsList.filter.category')}</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            style={{ ...textInput, minWidth: 200 }}
          >
            <option value="ALL">{t('admin.productsList.filter.allCategories')}</option>
            {(categoriesQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label style={filterField}>
          <span style={filterLabel}>{t('admin.productsList.filter.type')}</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            style={{ ...textInput, minWidth: 150 }}
          >
            <option value="ALL">{t('admin.productsList.filter.allTypes')}</option>
            {PRODUCT_TYPES.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>

        <div style={filterField}>
          <span style={filterLabel}>{t('admin.productsList.filter.status')}</span>
          <div style={pillRow}>
            {(['ACTIVE', 'ALL', 'INACTIVE'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                style={{ ...pillBtn, ...(status === s ? pillBtnActive : {}) }}
              >
                {s === 'ACTIVE'
                  ? t('admin.productsList.filter.statusActive')
                  : s === 'ALL'
                    ? t('admin.productsList.filter.statusAll')
                    : t('admin.productsList.filter.statusInactive')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={tableShell}>
        <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
          <span>{t('admin.productsList.col.name')}</span>
          <span>{t('admin.productsList.col.category')}</span>
          <span>{t('admin.productsList.col.type')}</span>
          <span style={cellNumHead}>{t('admin.productsList.col.price')}</span>
          <span style={cellNumHead}>{t('admin.productsList.col.variants')}</span>
          <span>{t('admin.productsList.col.status')}</span>
        </div>

        {isLoading && (
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={emptyState}>
            <p style={emptyTitle}>{t('admin.productsList.empty')}</p>
            <p style={emptyHint}>{t('admin.productsList.emptyHint')}</p>
          </div>
        )}

        {!isLoading &&
          filtered.map((row) => {
            const pl = priceLine(row);
            const isActive = row.active;
            const categoryName =
              row.category_id !== null
                ? categoryNameById.get(row.category_id) ?? '—'
                : '—';
            const variantCount = row.variants.filter((v) => v.active).length;

            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpen(row.id)}
                style={{ ...tableRow, gridTemplateColumns: COLS }}
              >
                <span style={nameCell}>
                  <span style={nameMain}>{row.name}</span>
                  {row.barcode ? (
                    <span style={nameSub}>{row.barcode}</span>
                  ) : (
                    <span style={nameSubMuted}>
                      {t('admin.productsList.drawer.noBarcode')}
                    </span>
                  )}
                </span>
                <span style={cellMuted}>{categoryName}</span>
                <span style={typeCell}>
                  <span style={{ ...typeBadge, ...productTypeBadgeStyle(row.type) }}>
                    {productTypeLabel(row.type)}
                  </span>
                </span>
                <span style={cellNum}>{pl.label}</span>
                <span style={cellNum}>
                  {variantCount === 0 ? '—' : variantCount}
                </span>
                <span>
                  <span
                    style={{
                      ...statusBadge,
                      ...(isActive ? statusBadgeOk : statusBadgeOff),
                    }}
                  >
                    {isActive
                      ? t('admin.productsList.status.active')
                      : t('admin.productsList.status.inactive')}
                  </span>
                </span>
              </button>
            );
          })}
      </div>
    </AdminViewShell>
  );
}

/* ── Toast (reused across sub-views) ────────────────────────────────────── */

function Toast({ kind, text }: { kind: 'ok' | 'err'; text: string }) {
  return (
    <div
      role="status"
      style={{
        ...toastStyle,
        background: kind === 'ok' ? 'var(--green)' : 'var(--red)',
      }}
    >
      {text}
    </div>
  );
}

/* ── KPI sub-cell ───────────────────────────────────────────────────────── */

interface KpiCellProps {
  label: string;
  value: string;
  hint: string;
  valueColor?: string;
  muted?: boolean;
}

function KpiCell({ label, value, hint, valueColor, muted }: KpiCellProps) {
  return (
    <div style={kpiCellStyle}>
      <span style={kpiLabel}>{label}</span>
      <span
        style={{
          ...kpiValue,
          ...(valueColor ? { color: valueColor } : {}),
          ...(muted ? { color: 'var(--text2)' } : {}),
        }}
      >
        {value}
      </span>
      <span style={kpiHint}>{hint}</span>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const COLS =
  'minmax(220px, 2.1fr) minmax(120px, 1fr) minmax(110px, 0.9fr) 120px 100px 90px';

const headerActions: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
};

const countPill: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const btnPrimary: CSSProperties = {
  padding: '0 16px',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const kpiGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 14,
  marginBottom: 18,
};

const kpiCellStyle: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '14px 18px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const kpiLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const kpiValue: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 26,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.05,
  letterSpacing: '-0.005em',
};

const kpiHint: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  marginTop: 2,
};

const filterBar: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'flex-end',
  marginBottom: 14,
};

const filterField: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const filterLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const textInput: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const pillRow: CSSProperties = {
  display: 'inline-flex',
  gap: 6,
};

const pillBtn: CSSProperties = {
  padding: '7px 13px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
  minHeight: 34,
};

const pillBtnActive: CSSProperties = {
  background: 'var(--text1)',
  color: '#fff',
  borderColor: 'var(--text1)',
};

const tableShell: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
  marginTop: 6,
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '12px 20px',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  gap: 14,
  alignItems: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  width: '100%',
  padding: '13px 20px',
  borderTop: '1px solid var(--border)',
  gap: 14,
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 48,
};

const cellMuted: CSSProperties = {
  color: 'var(--text2)',
  fontSize: 13,
};

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: "'Playfair Display', serif",
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text1)',
};

const cellNumHead: CSSProperties = {
  textAlign: 'right',
};

const nameCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const nameMain: CSSProperties = {
  fontWeight: 600,
  color: 'var(--text1)',
  fontSize: 13.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const nameSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  letterSpacing: '0.04em',
};

const nameSubMuted: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontStyle: 'italic',
};

const typeCell: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const typeBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

const statusBadgeOk: CSSProperties = {
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
  border: '1px solid rgba(74,140,92,0.30)',
};

const statusBadgeOff: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const spinnerWrap: CSSProperties = {
  padding: 36,
  display: 'flex',
  justifyContent: 'center',
};

const emptyState: CSSProperties = {
  padding: '64px 24px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'center',
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

const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 18px',
  borderRadius: 999,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  zIndex: 300,
  boxShadow: '0 12px 32px rgba(0,0,0,0.24)',
};
