// Inventory · Supplies list — browse the catalog, search, filter and edit.
//
// One screen, one job (PRODUCT.md):
//   - Browse every supply (filter by status, category, base unit + free-text).
//   - See on-hand stock summed across storages with a low-stock signal.
//   - Tap a row → drawer with avg/last cost, stock-per-storage, and an edit form.
//   - Soft-delete (deactivate) or reactivate from inside the drawer.
//
// Out of scope (other views own these):
//   - Creating a supply        → SupplyNewView.
//   - Drafting a purchase      → PurchaseOrdersView.
//   - Logging a write-off      → WriteOffsView.
//   - Audit trail              → StockMovementsView.
//
// Backend touch points
//   GET    /api/v1/supplies                     — paginated catalog (includes category)
//   GET    /api/v1/supplies/:id/stocks          — stock rows per storage (drawer)
//   GET    /api/v1/supply-categories            — for filter + edit dropdown
//   GET    /api/v1/storages                     — to label storage rows in the drawer
//   PATCH  /api/v1/supplies/:id                 — edit metadata
//   DELETE /api/v1/supplies/:id                 — soft-delete (deactivate)
//
// We call /supplies directly via api.get rather than extending the shared
// supplies.ts client. The existing helpers there return a slim SupplySummary
// for pickers (no category/cost) — adding "rich" variants there would force
// downstream callers to handle the wider shape too. Local interfaces keep the
// blast radius to this file, matching the legacy SuppliesAdminView pattern.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { AdminViewShell } from './AdminViewShell';
import { SupplyInfoView } from './SupplyInfoView';
import { SupplyEditView } from './SupplyEditView';
import { SupplyDeleteModal } from './SupplyDeleteModal';
import { SupplyCascadeModal } from './SupplyCascadeModal';
import { adminStyles } from '../styles';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import { api } from '../../../api/client';
import type { PageResult } from '../../../api/pagination';
import { listStorages } from '../../../api/storages';
import { listSuppliers, type Supplier } from '../../../api/suppliers';
import { formatMoney, formatMoneyPlain } from '../../../utils/format';

// ─── Local types (matches the Prisma payload via include: { category }) ────

type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';
type ContentUnit = 'ML' | 'L' | 'G' | 'KG' | 'OZ' | 'FL_OZ';

const BASE_UNITS: BaseUnit[] = ['PIECE', 'BOTTLE', 'KG', 'LITER', 'BAG', 'BOX', 'UNIT'];

interface SupplyRow {
  id: string;
  name: string;
  barcode: string | null;
  base_unit: BaseUnit;
  content_per_unit: string | null;
  content_unit: ContentUnit | null;
  average_cost: string;
  last_cost: string;
  category_id: string;
  active: boolean;
  deleted_at: string | null;
  category?: { id: string; name: string } | null;
}

interface SupplyCategory {
  id: string;
  name: string;
}

interface SupplyStockRow {
  id: string;
  storage_id: string;
  quantity: string;
  min_stock: string | null;
  storage?: { id: string; name: string; active: boolean } | null;
}

type StatusFilter = 'ACTIVE' | 'ALL' | 'INACTIVE';

// Quick-toggle "issue" filters — each narrows to supplies needing attention.
// They compose (AND): switching on Low stock AND No cost shows only rows
// that hit both. Empty set = no issue filter applied.
type IssueId = 'low_stock' | 'missing_cost' | 'no_supplier';

// Slim row shape from /packagings — only what we need to build the
// supply→suppliers index for the supplier filter and the "no supplier" pill.
interface PackagingRow {
  id: string;
  supply_id: string;
  supplier_id: string;
  is_primary: boolean;
  active: boolean;
}

// Which screen the list is showing — 'list' is the default table; the three
// action buttons on each row open the matching sub-view. `supplyName` rides
// along on the typed payload so the Delete modal can render a title without
// re-fetching just for the name.
type SubView =
  | { kind: 'list' }
  | { kind: 'info'; supplyId: string; supplyName: string }
  | { kind: 'edit'; supplyId: string; supplyName: string }
  | { kind: 'delete'; supplyId: string; supplyName: string }
  | { kind: 'cascade'; supplyId: string; supplyName: string };

interface SuppliesListViewProps {
  onBack: () => void;
}

// ─── Data fetchers (drained pagination, ~hundreds of items max) ────────────

async function fetchAllSupplies(includeInactive: boolean): Promise<SupplyRow[]> {
  const out: SupplyRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (!includeInactive) sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<SupplyRow>>(`/supplies?${sp.toString()}`);
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 2000) break;
  } while (cursor);
  return out;
}

// All active packagings in one go — drives the supplier filter dropdown and
// the "no supplier" pill. Cafés typically have ≤ a few hundred rows; the
// pagination drain keeps it correct if a catalog grows past that.
async function fetchAllActivePackagings(): Promise<PackagingRow[]> {
  const out: PackagingRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<PackagingRow>>(
      `/packagings?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 2000) break;
  } while (cursor);
  return out;
}

async function fetchAllSupplyCategories(): Promise<SupplyCategory[]> {
  const out: SupplyCategory[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<SupplyCategory>>(
      `/supply-categories?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

// ─── Stock health (worst-of across storages) ───────────────────────────────

type StockHealth = 'ok' | 'warn' | 'low' | 'unknown';

// "Low" = any storage with a min_stock set is at or below it.
// "Warn" = any storage is within 25% of its min_stock.
// "Ok"   = at least one storage carries stock and none breach min.
// "Unknown" = no stock rows yet (e.g. brand-new supply with no purchase).
function computeStockHealth(stocks: SupplyStockRow[]): StockHealth {
  if (stocks.length === 0) return 'unknown';
  let worst: StockHealth = 'ok';
  for (const row of stocks) {
    if (row.min_stock === null) continue;
    const qty = new Decimal(row.quantity);
    const min = new Decimal(row.min_stock);
    if (qty.lte(min)) return 'low';
    // Within 25% of min — bump to warn but keep scanning for a low row.
    const buffer = min.mul(1.25);
    if (qty.lte(buffer)) worst = 'warn';
  }
  return worst;
}

function healthColor(h: StockHealth): string {
  switch (h) {
    case 'low':
      return 'var(--red)';
    case 'warn':
      return 'var(--gold)';
    case 'ok':
      return 'var(--green)';
    case 'unknown':
      return 'var(--text3)';
  }
}

// Sum stock quantity across all storages, in base units.
function sumStock(stocks: SupplyStockRow[]): Decimal {
  return stocks.reduce((acc, r) => acc.add(new Decimal(r.quantity)), new Decimal(0));
}

// ─── Display helpers ───────────────────────────────────────────────────────

const UNIT_LABEL_SHORT: Record<BaseUnit, string> = {
  PIECE: 'pc',
  BOTTLE: 'btl',
  KG: 'kg',
  LITER: 'L',
  BAG: 'bag',
  BOX: 'box',
  UNIT: 'un',
};

function formatQty(value: Decimal | string | number, unit: BaseUnit): string {
  const dec = value instanceof Decimal ? value : new Decimal(value);
  // Trim trailing zeros for whole numbers — 24 stays 24, 24.5 stays 24.5.
  const rounded = dec.toDecimalPlaces(2);
  const numText = rounded.toString();
  return `${numText} ${UNIT_LABEL_SHORT[unit] ?? unit.toLowerCase()}`;
}

function formatContent(perUnit: string | null, unit: ContentUnit | null): string | null {
  if (!perUnit || !unit) return null;
  const n = new Decimal(perUnit);
  return `${n.toDecimalPlaces(2).toString()} ${unit.toLowerCase().replace('_', ' ')}`;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

// ─── Component ─────────────────────────────────────────────────────────────

export function SuppliesListView({ onBack }: SuppliesListViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [search, setSearch] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('ALL');
  const [unit, setUnit] = useState<'ALL' | BaseUnit>('ALL');
  const [supplierId, setSupplierId] = useState<string>('ALL');
  const [issueFilters, setIssueFilters] = useState<Set<IssueId>>(() => new Set());
  // The list owns three "sub-pages" reached from the row action buttons:
  // Info and Edit replace the list surface entirely (full-page views), while
  // Delete renders as an overlay modal on top of the list.
  const [subView, setSubView] = useState<SubView>({ kind: 'list' });
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t0 = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t0);
  }, [toast]);

  const suppliesQuery = useQuery({
    queryKey: ['admin', 'supplies', { includeInactive: status !== 'ACTIVE' }],
    queryFn: () => fetchAllSupplies(status !== 'ACTIVE'),
    staleTime: 30_000,
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'supplyCategories'],
    queryFn: fetchAllSupplyCategories,
    staleTime: 5 * 60_000,
  });

  // Powers the Supplier dropdown. Same caché as the rest of the admin uses.
  const suppliersQuery = useQuery({
    queryKey: ['suppliers', { active: true }],
    queryFn: () => listSuppliers({ active: true }),
    staleTime: 5 * 60_000,
  });

  // Powers both the Supplier filter (which supplies a given supplier carries)
  // and the "No supplier" issue pill (supplies with no active packaging at all).
  const packagingsQuery = useQuery({
    queryKey: ['admin', 'purchasePackagings', { active: true }],
    queryFn: fetchAllActivePackagings,
    staleTime: 60_000,
  });

  // Stocks for ALL active supplies — drives the on-hand column and the low-
  // stock KPI. One per-storage fetch and we stitch in memory. Same cost as
  // the legacy admin view; cafés have ≤ ~10 storages.
  const storagesQuery = useQuery({
    queryKey: ['admin', 'storages', 'active'],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });

  const stocksQuery = useQuery({
    queryKey: ['admin', 'supplies', 'stocksAll', storagesQuery.data?.map((s) => s.id)],
    enabled: !!storagesQuery.data && storagesQuery.data.length > 0,
    queryFn: async () => {
      const storages = storagesQuery.data ?? [];
      const allRows = await Promise.all(
        storages.map(async (s) => {
          const out: SupplyStockRow[] = [];
          let cursor: string | null = null;
          do {
            const sp = new URLSearchParams();
            sp.set('limit', '100');
            if (cursor) sp.set('cursor', cursor);
            const page = await api.get<PageResult<SupplyStockRow>>(
              `/storages/${s.id}/stocks?${sp.toString()}`,
            );
            // The storage endpoint returns supply_id, not the storage_id, so
            // we tag the storage onto each row for downstream grouping.
            for (const row of page.items) {
              out.push({ ...row, storage_id: s.id, storage: { id: s.id, name: s.name, active: s.active } });
            }
            cursor = page.nextCursor;
            if (out.length >= 2000) break;
          } while (cursor);
          return out;
        }),
      );
      return allRows.flat();
    },
    staleTime: 30_000,
  });

  // supply_id → Set<supplier_id> over ACTIVE packagings. Drives the supplier
  // filter ("show me the supplies this supplier provides") and the
  // "No supplier" pill (supplies that don't appear as a key here).
  const suppliersBySupply = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of packagingsQuery.data ?? []) {
      const set = map.get(p.supply_id) ?? new Set<string>();
      set.add(p.supplier_id);
      map.set(p.supply_id, set);
    }
    return map;
  }, [packagingsQuery.data]);

  const stocksBySupply = useMemo(() => {
    const map = new Map<string, SupplyStockRow[]>();
    for (const row of stocksQuery.data ?? []) {
      const key = (row as SupplyStockRow & { supply_id?: string }).supply_id ?? '';
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [stocksQuery.data]);

  const allRows = suppliesQuery.data ?? [];

  // Status filter (server already drops inactives when ACTIVE; here we further
  // narrow to INACTIVE-only when that pill is active).
  const filteredByStatus = useMemo(() => {
    if (status === 'ALL') return allRows;
    if (status === 'ACTIVE') return allRows.filter((r) => r.active && r.deleted_at === null);
    return allRows.filter((r) => !r.active || r.deleted_at !== null);
  }, [allRows, status]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const wantLow = issueFilters.has('low_stock');
    const wantMissing = issueFilters.has('missing_cost');
    const wantNoSupplier = issueFilters.has('no_supplier');

    return filteredByStatus.filter((r) => {
      if (categoryId !== 'ALL' && r.category_id !== categoryId) return false;
      if (unit !== 'ALL' && r.base_unit !== unit) return false;
      if (q) {
        const hay = `${r.name} ${r.barcode ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (supplierId !== 'ALL') {
        const set = suppliersBySupply.get(r.id);
        if (!set || !set.has(supplierId)) return false;
      }
      if (wantLow) {
        const health = computeStockHealth(stocksBySupply.get(r.id) ?? []);
        if (health !== 'low') return false;
      }
      if (wantMissing) {
        if (!new Decimal(r.average_cost || '0').isZero()) return false;
      }
      if (wantNoSupplier) {
        const set = suppliersBySupply.get(r.id);
        if (set && set.size > 0) return false;
      }
      return true;
    });
  }, [
    filteredByStatus,
    search,
    categoryId,
    unit,
    supplierId,
    issueFilters,
    suppliersBySupply,
    stocksBySupply,
  ]);

  function toggleIssue(id: IssueId) {
    setIssueFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // KPI metrics — derived from ALL supplies (not the filtered set) so the
  // numbers reflect the catalog truth rather than the operator's current view.
  const kpis = useMemo(() => {
    const active = allRows.filter((r) => r.active && r.deleted_at === null);
    const inactive = allRows.length - active.length;
    let lowCount = 0;
    let catalogValueCents = new Decimal(0);
    for (const supply of active) {
      const stocks = stocksBySupply.get(supply.id) ?? [];
      const health = computeStockHealth(stocks);
      if (health === 'low') lowCount += 1;
      const total = sumStock(stocks);
      const cost = new Decimal(supply.average_cost || '0');
      catalogValueCents = catalogValueCents.add(total.mul(cost));
    }
    return {
      tracked: active.length,
      inactive,
      lowCount,
      catalogValueCents: catalogValueCents.toDecimalPlaces(0).toNumber(),
    };
  }, [allRows, stocksBySupply]);

  const isLoading = suppliesQuery.isLoading || categoriesQuery.isLoading || storagesQuery.isLoading;

  // Sub-page short-circuits: render the dedicated Info/Edit pages instead of
  // the list. They handle their own AdminViewShell, so we don't render ours.
  if (subView.kind === 'info') {
    return (
      <SupplyInfoView
        supplyId={subView.supplyId}
        onBack={() => setSubView({ kind: 'list' })}
        onEdit={() =>
          setSubView({
            kind: 'edit',
            supplyId: subView.supplyId,
            supplyName: subView.supplyName,
          })
        }
        onDelete={() =>
          setSubView({
            kind: 'delete',
            supplyId: subView.supplyId,
            supplyName: subView.supplyName,
          })
        }
      />
    );
  }
  if (subView.kind === 'edit') {
    return (
      <SupplyEditView
        supplyId={subView.supplyId}
        onBack={() => setSubView({ kind: 'list' })}
        onSaved={(text) => setToast({ kind: 'ok', text })}
        onError={(text) => setToast({ kind: 'err', text })}
      />
    );
  }

  const countLabel =
    filtered.length === 1
      ? t('admin.suppliesList.count.shownOne')
      : interpolate(t('admin.suppliesList.count.shown'), { count: filtered.length });

  return (
    <AdminViewShell
      titleKey="admin.suppliesList.title"
      subtitleKey="admin.suppliesList.subtitle"
      onBack={onBack}
      headerActions={
        <span style={countPill} aria-live="polite">
          {countLabel}
        </span>
      }
    >
      {/* ─── KPI strip ──────────────────────────────────────────────────── */}
      <div style={kpiGrid}>
        <KpiCell
          label={t('admin.suppliesList.kpi.tracked')}
          value={String(kpis.tracked)}
          hint={t('admin.suppliesList.kpi.trackedHint')}
        />
        <KpiCell
          label={t('admin.suppliesList.kpi.low')}
          value={String(kpis.lowCount)}
          hint={t('admin.suppliesList.kpi.lowHint')}
          valueColor={kpis.lowCount > 0 ? 'var(--red)' : undefined}
          dot={kpis.lowCount > 0 ? 'var(--red)' : undefined}
        />
        <KpiCell
          label={t('admin.suppliesList.kpi.value')}
          value={formatMoney(kpis.catalogValueCents)}
          hint={t('admin.suppliesList.kpi.valueHint')}
        />
        <KpiCell
          label={t('admin.suppliesList.kpi.inactive')}
          value={String(kpis.inactive)}
          hint={t('admin.suppliesList.kpi.inactiveHint')}
          muted
        />
      </div>

      {/* ─── Filter toolbar ─────────────────────────────────────────────── */}
      <div style={filterBar}>
        <label style={{ ...filterField, flex: 1, minWidth: 240 }}>
          <span style={filterLabel}>{t('admin.suppliesList.filter.search')}</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.suppliesList.filter.searchPlaceholder')}
            style={textInput}
          />
        </label>

        <label style={filterField}>
          <span style={filterLabel}>{t('admin.suppliesList.filter.category')}</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            style={{ ...textInput, minWidth: 200 }}
          >
            <option value="ALL">{t('admin.suppliesList.filter.allCategories')}</option>
            {(categoriesQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label style={filterField}>
          <span style={filterLabel}>{t('admin.suppliesList.filter.unit')}</span>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as 'ALL' | BaseUnit)}
            style={{ ...textInput, minWidth: 130 }}
          >
            <option value="ALL">{t('admin.suppliesList.filter.allUnits')}</option>
            {BASE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <label style={filterField}>
          <span style={filterLabel}>{t('admin.suppliesList.filter.supplier')}</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={suppliersQuery.isLoading}
            style={{ ...textInput, minWidth: 180 }}
          >
            <option value="ALL">{t('admin.suppliesList.filter.allSuppliers')}</option>
            {(suppliersQuery.data ?? []).map((s: Supplier) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <div style={filterField}>
          <span style={filterLabel}>{t('admin.suppliesList.filter.status')}</span>
          <div style={pillRow}>
            {(['ACTIVE', 'ALL', 'INACTIVE'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                style={{
                  ...pillBtn,
                  ...(status === s ? pillBtnActive : {}),
                }}
              >
                {s === 'ACTIVE'
                  ? t('admin.suppliesList.filter.statusActive')
                  : s === 'ALL'
                    ? t('admin.suppliesList.filter.statusAll')
                    : t('admin.suppliesList.filter.statusInactive')}
              </button>
            ))}
          </div>
        </div>

        <div style={filterField}>
          <span style={filterLabel}>{t('admin.suppliesList.filter.issues')}</span>
          <div style={pillRow}>
            <IssuePill
              active={issueFilters.has('low_stock')}
              onClick={() => toggleIssue('low_stock')}
              tone="red"
            >
              {t('admin.suppliesList.filter.lowStock')}
            </IssuePill>
            <IssuePill
              active={issueFilters.has('missing_cost')}
              onClick={() => toggleIssue('missing_cost')}
              tone="gold"
            >
              {t('admin.suppliesList.filter.missingCost')}
            </IssuePill>
            <IssuePill
              active={issueFilters.has('no_supplier')}
              onClick={() => toggleIssue('no_supplier')}
              tone="gold"
            >
              {t('admin.suppliesList.filter.noSupplier')}
            </IssuePill>
          </div>
        </div>
      </div>

      {/* ─── Table ──────────────────────────────────────────────────────── */}
      <div style={tableShell}>
        <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
          <span>{t('admin.suppliesList.col.name')}</span>
          <span>{t('admin.suppliesList.col.category')}</span>
          <span>{t('admin.suppliesList.col.unit')}</span>
          <span style={cellNumHead}>{t('admin.suppliesList.col.avgCost')}</span>
          <span style={cellNumHead}>{t('admin.suppliesList.col.stock')}</span>
          <span>{t('admin.suppliesList.col.status')}</span>
          <span style={actionsHead}>{t('admin.suppliesList.col.actions')}</span>
        </div>

        {isLoading && (
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={emptyState}>
            <p style={emptyTitle}>{t('admin.suppliesList.empty')}</p>
            <p style={emptyHint}>{t('admin.suppliesList.emptyHint')}</p>
          </div>
        )}

        {!isLoading &&
          filtered.map((row) => {
            const stocks = stocksBySupply.get(row.id) ?? [];
            const health = computeStockHealth(stocks);
            const total = sumStock(stocks);
            const contentLine = formatContent(row.content_per_unit, row.content_unit);
            const isActive = row.active && row.deleted_at === null;

            return (
              <div
                key={row.id}
                style={{
                  ...tableRow,
                  gridTemplateColumns: COLS,
                }}
              >
                <span style={nameCell}>
                  <span style={nameMain}>{row.name}</span>
                  {row.barcode ? (
                    <span style={nameSub}>{row.barcode}</span>
                  ) : (
                    <span style={nameSubMuted}>
                      {t('admin.suppliesList.drawer.noBarcode')}
                    </span>
                  )}
                </span>
                <span style={cellMuted}>
                  {row.category?.name ?? '—'}
                </span>
                <span style={unitCell}>
                  <span style={unitMain}>{row.base_unit}</span>
                  {contentLine && <span style={unitSub}>{contentLine}</span>}
                </span>
                <span style={cellNum}>
                  <span style={moneyNumeral}>{formatMoneyPlain(row.average_cost)}</span>
                </span>
                <span style={cellNum}>
                  <span style={stockCell}>
                    <span style={dot(healthColor(health))} aria-hidden="true" />
                    <span style={stockText}>
                      {stocks.length === 0 ? '—' : formatQty(total, row.base_unit)}
                    </span>
                  </span>
                </span>
                <span>
                  <span
                    style={{
                      ...statusBadge,
                      ...(isActive ? statusBadgeOk : statusBadgeOff),
                    }}
                  >
                    {isActive
                      ? t('admin.suppliesList.status.active')
                      : t('admin.suppliesList.status.inactive')}
                  </span>
                </span>
                <span
                  style={actionsCell}
                  aria-label={interpolate(t('admin.suppliesList.action.aria'), {
                    name: row.name,
                  })}
                >
                  <button
                    type="button"
                    style={actionBtnInfo}
                    onClick={() =>
                      setSubView({
                        kind: 'info',
                        supplyId: row.id,
                        supplyName: row.name,
                      })
                    }
                  >
                    {t('admin.suppliesList.action.info')}
                  </button>
                  <button
                    type="button"
                    style={actionBtnEdit}
                    onClick={() =>
                      setSubView({
                        kind: 'edit',
                        supplyId: row.id,
                        supplyName: row.name,
                      })
                    }
                  >
                    {t('admin.suppliesList.action.edit')}
                  </button>
                  <button
                    type="button"
                    style={actionBtnDelete}
                    onClick={() =>
                      setSubView({
                        kind: 'delete',
                        supplyId: row.id,
                        supplyName: row.name,
                      })
                    }
                  >
                    {t('admin.suppliesList.action.delete')}
                  </button>
                </span>
              </div>
            );
          })}
      </div>

      {/* ─── Delete confirmation (overlay) ──────────────────────────────── */}
      {subView.kind === 'delete' && (
        <SupplyDeleteModal
          supplyId={subView.supplyId}
          supplyName={subView.supplyName}
          onClose={() => setSubView({ kind: 'list' })}
          onDeleted={(text) => {
            setToast({ kind: 'ok', text });
            queryClient.invalidateQueries({ queryKey: ['admin', 'supplies'] });
          }}
          onError={(text) => setToast({ kind: 'err', text })}
          onResolveCascade={() =>
            setSubView({
              kind: 'cascade',
              supplyId: subView.supplyId,
              supplyName: subView.supplyName,
            })
          }
        />
      )}

      {subView.kind === 'cascade' && (
        <SupplyCascadeModal
          supplyId={subView.supplyId}
          supplyName={subView.supplyName}
          onClose={() => setSubView({ kind: 'list' })}
          onResolved={(text) => {
            setToast({ kind: 'ok', text });
            queryClient.invalidateQueries({ queryKey: ['admin', 'supplies'] });
          }}
          onError={(text) => setToast({ kind: 'err', text })}
        />
      )}

      {/* ─── Toast ──────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          style={{
            ...toastStyle,
            background: toast.kind === 'ok' ? 'var(--green)' : 'var(--red)',
          }}
        >
          {toast.text}
        </div>
      )}
    </AdminViewShell>
  );
}


// ─── Small presentational subcomponents ────────────────────────────────────

interface IssuePillProps {
  active: boolean;
  onClick: () => void;
  tone: 'red' | 'gold';
  children: React.ReactNode;
}

// Issue pills mirror the status pills shape but carry a coloured dot so the
// operator scans the row by severity. Inactive state stays neutral; active
// state borrows the tone colour for both the dot and the chip surface.
function IssuePill({ active, onClick, tone, children }: IssuePillProps) {
  const dotColor = tone === 'red' ? 'var(--red)' : 'var(--gold)';
  const activeStyle: CSSProperties = active
    ? tone === 'red'
      ? {
          background: 'rgba(196,80,64,0.10)',
          color: 'var(--red)',
          borderColor: 'rgba(196,80,64,0.40)',
        }
      : {
          background: 'rgba(201,164,92,0.12)',
          color: '#7a5a1f',
          borderColor: 'rgba(201,164,92,0.45)',
        }
    : {};
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...pillBtn, ...activeStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
      aria-pressed={active}
    >
      <span style={{ ...dot(dotColor), width: 7, height: 7 }} aria-hidden="true" />
      {children}
    </button>
  );
}

interface KpiCellProps {
  label: string;
  value: string;
  hint: string;
  valueColor?: string;
  dot?: string;
  muted?: boolean;
}

function KpiCell({ label, value, hint, valueColor, dot: dotColor, muted }: KpiCellProps) {
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
        {dotColor && <span style={{ ...dot(dotColor), marginRight: 8, verticalAlign: 'middle' }} />}
        {value}
      </span>
      <span style={kpiHint}>{hint}</span>
    </div>
  );
}

// ─── Local styles (kept beside the component for direct edit) ──────────────

// 7 tracks: name / category / unit / avg cost / stock / status / actions.
const COLS =
  'minmax(200px, 1.9fr) minmax(110px, 0.9fr) minmax(100px, 0.9fr) 110px 130px 90px minmax(230px, auto)';

const countPill: CSSProperties = {
  ...adminStyles.kpiLabel,
  padding: '7px 12px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontVariantNumeric: 'tabular-nums',
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
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.02em',
};

const nameSubMuted: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontStyle: 'italic',
};

const unitCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minWidth: 0,
};

const unitMain: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text1)',
  letterSpacing: '0.04em',
};

const unitSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
};

const moneyNumeral: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 15,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const stockCell: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
};

const stockText: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFamily: "'Playfair Display', serif",
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text1)',
};

function dot(color: string): CSSProperties {
  return {
    display: 'inline-block',
    width: 9,
    height: 9,
    borderRadius: '50%',
    background: color,
  };
}

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

// ─── Row action buttons ────────────────────────────────────────────────────
// Three small chips per row (Info / Edit / Delete). Right-aligned so the
// operator's eye lands on the action lane after scanning the metric columns.

const actionsHead: CSSProperties = {
  textAlign: 'right',
  paddingRight: 4,
};

const actionsCell: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
};

const actionBtnBase: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 7,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  border: '1px solid transparent',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  minHeight: 30,
};

const actionBtnInfo: CSSProperties = {
  ...actionBtnBase,
  borderColor: 'var(--border)',
  color: 'var(--text1)',
};

const actionBtnEdit: CSSProperties = {
  ...actionBtnBase,
  borderColor: 'rgba(201,164,92,0.40)',
  background: 'rgba(201,164,92,0.08)',
  color: '#7a5a1f',
};

const actionBtnDelete: CSSProperties = {
  ...actionBtnBase,
  borderColor: 'rgba(196,80,64,0.30)',
  background: 'transparent',
  color: 'var(--red)',
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
