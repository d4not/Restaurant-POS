// Purchase orders — admin workspace.
//
// Two modes, swapped via a segmented control in the AdminViewShell header:
//
//   LEDGER     Read-mostly. Filter strip → KPIs → date-grouped table.
//              Click a row to expand inline; from there DRAFT rows expose
//              "Confirm" (which triggers stock + WAC on the backend) and
//              "Cancel".
//
//   COMPOSE    Single-purpose draft form. Header (supplier, receiving
//              storage, date), supply-search-driven line builder, notes,
//              running total, "Save as draft" CTA. Save snaps back to
//              the ledger.
//
// Why segmented modes, not the legacy split: the operator's two real moments
// (confirm what arrived today vs. draft tomorrow's order) each deserve the
// full viewport. Splitting them both is denser but punishes each task.
// Per PRODUCT.md: one screen, one job.
//
// Money is centavos integers everywhere except the compose form's price
// inputs, which are typed in pesos for the user and converted on submit.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';

import { AdminViewShell } from './AdminViewShell';
import { useTranslation } from '../../../i18n';
import { api, ApiError } from '../../../api/client';
import type { PageResult } from '../../../api/pagination';
import { listStorages } from '../../../api/storages';
import { listSuppliers, type Supplier } from '../../../api/suppliers';
import { searchSupplies, type SupplySearchResult } from '../../../api/supplies';
import { listPackagings, type PurchasePackaging } from '../../../api/packagings';
import {
  createPurchase,
  type CreatePurchaseInput,
  type Purchase,
  type PurchaseStatus,
} from '../../../api/purchases';
import { formatMoney } from '../../../utils/format';
import { Spinner } from '../../Spinner';
import { IconPlus, IconChevronDown, IconClose, IconCheck } from '../../Icons';
import { IconTrash } from '../../operations-hub/HubIcons';
import { IconSearch, IconClipboard } from '../icons';

// ─── Local API shapes ──────────────────────────────────────────────────────
//
// Backend returns Purchases enriched with supplier/storage/user joins + items
// when you call list/get. The shipped `purchases.ts` client only declared the
// minimum for create, so we type the richer shape locally — additive and
// scoped to this view.

interface PurchaseItemRow {
  id: string;
  supply_id: string;
  packaging_id: string | null;
  package_quantity: string;
  price_per_package: string;
  base_unit_quantity: string;
  unit_cost: string;
  supply: { id: string; name: string; base_unit: string } | null;
  packaging: {
    id: string;
    name: string;
    units_per_package: string;
  } | null;
}

interface PurchaseDetail extends Purchase {
  items: PurchaseItemRow[];
  supplier?: { id: string; name: string } | null;
  storage?: { id: string; name: string } | null;
  user?: { id: string; name: string } | null;
}

interface ListFilters {
  status: PurchaseStatus | 'ALL';
  supplierId: string;
  from: string;
  to: string;
}

// ─── Compose state ─────────────────────────────────────────────────────────

interface DraftLine {
  uid: string;
  supplyId: string;
  supplyName: string;
  baseUnit: string;
  packagings: PurchasePackaging[];
  packagingsLoading: boolean;
  packagingId: string | null;
  packageQuantity: string;
  /** Pesos string — converted to centavos on submit. */
  pricePerPackagePesos: string;
}

type Mode = 'ledger' | 'compose';

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function safeNum(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function lineTotalCentavos(line: DraftLine): number {
  return Math.round(
    safeNum(line.packageQuantity) * safeNum(line.pricePerPackagePesos) * 100,
  );
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoFromDateInput(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
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

function dayKey(iso: string): string {
  // Group by the LOCAL day so the operator sees their own midnight.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── API helpers (scoped to this view) ─────────────────────────────────────

async function fetchPurchases(f: ListFilters): Promise<PurchaseDetail[]> {
  const out: PurchaseDetail[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '50');
    if (f.status !== 'ALL') sp.set('status', f.status);
    if (f.supplierId) sp.set('supplier_id', f.supplierId);
    const fromIso = isoFromDateInput(f.from);
    const toIso = isoFromDateInput(f.to, true);
    if (fromIso) sp.set('from', fromIso);
    if (toIso) sp.set('to', toIso);
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<PurchaseDetail>>(
      `/purchases?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

function getPurchase(id: string): Promise<PurchaseDetail> {
  return api.get<PurchaseDetail>(`/purchases/${id}`);
}

function confirmPurchaseReq(id: string): Promise<PurchaseDetail> {
  return api.post<PurchaseDetail>(`/purchases/${id}/confirm`, {});
}

function cancelPurchaseReq(id: string): Promise<PurchaseDetail> {
  return api.post<PurchaseDetail>(`/purchases/${id}/cancel`, {});
}

// ─── Component ─────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

export function PurchaseOrdersView({ onBack }: Props) {
  const [mode, setMode] = useState<Mode>('ledger');
  const [composeFlash, setComposeFlash] = useState<string | null>(null);

  // The header carries the segmented control on both modes, plus the
  // "+ New PO" shortcut on the ledger. Compose hides the shortcut to keep
  // attention on the form.
  const headerActions = (
    <ModeSwitcher
      mode={mode}
      onChange={setMode}
      onNew={() => {
        setComposeFlash(null);
        setMode('compose');
      }}
    />
  );

  return (
    <AdminViewShell
      titleKey="admin.purchaseOrders.title"
      subtitleKey="admin.purchaseOrders.subtitle"
      onBack={onBack}
      headerActions={headerActions}
    >
      {mode === 'ledger' ? (
        <LedgerPane
          successFlash={composeFlash}
          dismissFlash={() => setComposeFlash(null)}
        />
      ) : (
        <ComposePane
          onCancel={() => setMode('ledger')}
          onSaved={(msg) => {
            setComposeFlash(msg);
            setMode('ledger');
          }}
        />
      )}
    </AdminViewShell>
  );
}

// ─── Mode switcher ─────────────────────────────────────────────────────────

interface ModeSwitcherProps {
  mode: Mode;
  onChange: (m: Mode) => void;
  onNew: () => void;
}

function ModeSwitcher({ mode, onChange, onNew }: ModeSwitcherProps) {
  const { t } = useTranslation();
  return (
    <div style={S.modeBar}>
      <div style={S.segment} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'ledger'}
          style={mode === 'ledger' ? S.segmentBtnOn : S.segmentBtn}
          onClick={() => onChange('ledger')}
        >
          {t('admin.purchaseOrders.modeLedger')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'compose'}
          style={mode === 'compose' ? S.segmentBtnOn : S.segmentBtn}
          onClick={() => onChange('compose')}
        >
          {t('admin.purchaseOrders.modeCompose')}
        </button>
      </div>
      {mode === 'ledger' && (
        <button type="button" style={S.newCta} onClick={onNew}>
          <IconPlus style={{ fontSize: 14 }} />
          <span>{t('admin.purchaseOrders.newOrder')}</span>
        </button>
      )}
    </div>
  );
}

// ─── Ledger pane ──────────────────────────────────────────────────────────

interface LedgerProps {
  successFlash: string | null;
  dismissFlash: () => void;
}

function LedgerPane({ successFlash, dismissFlash }: LedgerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<ListFilters>({
    status: 'ALL',
    supplierId: '',
    from: '',
    to: '',
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ['suppliers', { active: true }],
    queryFn: () => listSuppliers({ active: true }),
    staleTime: 5 * 60_000,
  });
  const suppliers = suppliersQuery.data ?? [];

  const purchasesQuery = useQuery({
    queryKey: ['admin-purchases', filters],
    queryFn: () => fetchPurchases(filters),
    staleTime: 15_000,
  });
  const purchases = useMemo(
    () => purchasesQuery.data ?? [],
    [purchasesQuery.data],
  );

  // KPI roll-up: counts per status and confirmed-spend across the page.
  const kpis = useMemo(() => {
    let drafts = 0;
    let confirmed = 0;
    let cancelled = 0;
    let confirmedTotal = new Decimal(0);
    for (const p of purchases) {
      if (p.status === 'DRAFT') drafts += 1;
      else if (p.status === 'CONFIRMED') {
        confirmed += 1;
        confirmedTotal = confirmedTotal.add(new Decimal(p.total));
      } else if (p.status === 'CANCELLED') cancelled += 1;
    }
    return { drafts, confirmed, cancelled, confirmedTotal };
  }, [purchases]);

  // Group by day, newest first. Within a day, the backend already orders by
  // (date desc, id asc), which we preserve.
  const grouped = useMemo(() => {
    const map = new Map<string, PurchaseDetail[]>();
    for (const p of purchases) {
      const k = dayKey(p.date);
      const bucket = map.get(k);
      if (bucket) bucket.push(p);
      else map.set(k, [p]);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [purchases]);

  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmPurchaseReq(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-purchases'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stocks'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelPurchaseReq(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-purchases'] });
    },
  });

  function actionError(): string | null {
    const err = confirmMutation.error ?? cancelMutation.error;
    if (!err) return null;
    return err instanceof ApiError ? err.message : t('error.somethingWrong');
  }

  const loading = purchasesQuery.isLoading;
  const empty = !loading && purchases.length === 0;

  return (
    <div style={S.ledgerPane}>
      {successFlash && (
        <div style={S.flashOk} role="status">
          <IconCheck style={{ fontSize: 14 }} />
          <span>{successFlash}</span>
          <button
            type="button"
            style={S.flashClose}
            onClick={dismissFlash}
            aria-label={t('common.close')}
          >
            <IconClose style={{ fontSize: 12 }} />
          </button>
        </div>
      )}

      <FilterStrip
        filters={filters}
        onChange={setFilters}
        suppliers={suppliers}
      />

      <div style={S.kpiStrip}>
        <Kpi label={t('admin.purchaseOrders.kpi.drafts')} value={kpis.drafts} accent="gold" />
        <Kpi
          label={t('admin.purchaseOrders.kpi.confirmed')}
          value={kpis.confirmed}
          accent="green"
        />
        <Kpi
          label={t('admin.purchaseOrders.kpi.cancelled')}
          value={kpis.cancelled}
          accent="muted"
        />
        <Kpi
          label={t('admin.purchaseOrders.kpi.spend')}
          money={kpis.confirmedTotal.toNumber()}
        />
      </div>

      {actionError() && <div style={S.bannerErr}>{actionError()}</div>}

      <div style={S.ledgerScroll}>
        {loading ? (
          <div style={S.center}>
            <Spinner />
          </div>
        ) : empty ? (
          <EmptyState />
        ) : (
          grouped.map(([day, rows]) => (
            <DayGroup
              key={day}
              day={day}
              rows={rows}
              expanded={expanded}
              setExpanded={setExpanded}
              onConfirm={(id) => confirmMutation.mutate(id)}
              onCancel={(id) => cancelMutation.mutate(id)}
              confirmingId={
                confirmMutation.isPending ? confirmMutation.variables ?? null : null
              }
              cancellingId={
                cancelMutation.isPending ? cancelMutation.variables ?? null : null
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Filter strip ──────────────────────────────────────────────────────────

interface FilterStripProps {
  filters: ListFilters;
  onChange: (next: ListFilters) => void;
  suppliers: Supplier[];
}

function FilterStrip({ filters, onChange, suppliers }: FilterStripProps) {
  const { t } = useTranslation();
  const statuses: Array<{ key: PurchaseStatus | 'ALL'; label: string }> = [
    { key: 'ALL', label: t('admin.purchaseOrders.status.all') },
    { key: 'DRAFT', label: t('admin.purchaseOrders.status.draft') },
    { key: 'CONFIRMED', label: t('admin.purchaseOrders.status.confirmed') },
    { key: 'CANCELLED', label: t('admin.purchaseOrders.status.cancelled') },
  ];

  return (
    <div style={S.filterStrip}>
      <div style={S.statusPills} role="tablist">
        {statuses.map((s) => {
          const active = filters.status === s.key;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={active}
              style={active ? S.pillOn : S.pill}
              onClick={() => onChange({ ...filters, status: s.key })}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <label style={S.fieldInline}>
        <span style={S.eyebrow}>{t('admin.purchaseOrders.filter.supplier')}</span>
        <select
          style={S.select}
          value={filters.supplierId}
          onChange={(e) => onChange({ ...filters, supplierId: e.target.value })}
        >
          <option value="">{t('admin.purchaseOrders.filter.allSuppliers')}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label style={S.fieldInline}>
        <span style={S.eyebrow}>{t('admin.purchaseOrders.filter.from')}</span>
        <input
          type="date"
          style={S.dateInput}
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
        />
      </label>

      <label style={S.fieldInline}>
        <span style={S.eyebrow}>{t('admin.purchaseOrders.filter.to')}</span>
        <input
          type="date"
          style={S.dateInput}
          value={filters.to}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
        />
      </label>
    </div>
  );
}

// ─── KPI card (tiny, no nested cards) ──────────────────────────────────────

interface KpiProps {
  label: string;
  value?: number;
  money?: number;
  accent?: 'gold' | 'green' | 'muted';
}

function Kpi({ label, value, money, accent }: KpiProps) {
  const tint =
    accent === 'gold'
      ? 'var(--gold)'
      : accent === 'green'
        ? 'var(--green)'
        : accent === 'muted'
          ? 'var(--text3)'
          : 'var(--text1)';
  return (
    <div style={S.kpi}>
      <span style={S.kpiLabel}>{label}</span>
      <span style={{ ...S.kpiValue, color: tint }}>
        {money !== undefined ? formatMoney(money) : value}
      </span>
    </div>
  );
}

// ─── Day group + rows ──────────────────────────────────────────────────────

const COLS = '14px 92px 1.4fr 1fr 64px 120px 28px';

interface DayGroupProps {
  day: string;
  rows: PurchaseDetail[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  confirmingId: string | null;
  cancellingId: string | null;
}

function DayGroup({
  day,
  rows,
  expanded,
  setExpanded,
  onConfirm,
  onCancel,
  confirmingId,
  cancellingId,
}: DayGroupProps) {
  const dayTotal = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'CONFIRMED')
        .reduce((sum, r) => sum.add(new Decimal(r.total)), new Decimal(0)),
    [rows],
  );

  // Pick the first row's iso as the day's display date — they share a key.
  const dayIso = rows[0]?.date ?? day;

  return (
    <section style={S.daySection}>
      <header style={S.dayHeader}>
        <h3 style={S.dayTitle}>{fmtDay(dayIso)}</h3>
        <span style={S.dayMeta}>
          {rows.length} · {formatMoney(dayTotal.toNumber())}
        </span>
      </header>

      <div style={S.dayList}>
        {rows.map((row) => (
          <LedgerRow
            key={row.id}
            row={row}
            expanded={expanded === row.id}
            onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
            onConfirm={onConfirm}
            onCancel={onCancel}
            confirming={confirmingId === row.id}
            cancelling={cancellingId === row.id}
          />
        ))}
      </div>
    </section>
  );
}

interface LedgerRowProps {
  row: PurchaseDetail;
  expanded: boolean;
  onToggle: () => void;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  confirming: boolean;
  cancelling: boolean;
}

function LedgerRow({
  row,
  expanded,
  onToggle,
  onConfirm,
  onCancel,
  confirming,
  cancelling,
}: LedgerRowProps) {
  const { t } = useTranslation();

  // Detail (items + joins) is included on list, but we re-query on expand so
  // a stale draft (item added in another tab) hydrates correctly the moment
  // the operator looks at it. Detail is the source of truth; the list row is
  // a summary.
  const detailQuery = useQuery({
    queryKey: ['admin-purchase', row.id, expanded],
    queryFn: () => getPurchase(row.id),
    enabled: expanded,
    staleTime: 10_000,
    initialData: row,
  });
  const detail = detailQuery.data ?? row;

  const supplierName = row.supplier?.name ?? '—';
  const storageName = row.storage?.name ?? '—';

  return (
    <div style={S.rowWrap}>
      <button
        type="button"
        style={{
          ...S.row,
          gridTemplateColumns: COLS,
          background: expanded ? '#fef8ef' : 'transparent',
        }}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <StatusDot status={row.status} />
        <StatusPill status={row.status} />
        <div style={S.rowSupplyCol}>
          <span style={S.rowSupplier}>{supplierName}</span>
          <span style={S.rowSubtle}>{storageName}</span>
        </div>
        <span style={S.rowSubtle}>{shortRef(row)}</span>
        <span style={{ ...S.numRight, color: 'var(--text2)' }}>
          {detail.items?.length ?? 0}
        </span>
        <span style={S.rowTotal}>{formatMoney(row.total)}</span>
        <IconChevronDown
          style={{
            fontSize: 14,
            color: 'var(--text3)',
            transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {expanded && (
        <div style={S.rowExpand} className="admin-view-enter">
          <ItemsSubgrid items={detail.items ?? []} loading={detailQuery.isLoading} />

          {row.notes && (
            <div style={S.notesBlock}>
              <span style={S.eyebrowSm}>
                {t('admin.purchaseOrders.detail.notes')}
              </span>
              <p style={S.notesText}>{row.notes}</p>
            </div>
          )}

          <div style={S.expandFoot}>
            {row.status === 'DRAFT' ? (
              <>
                <button
                  type="button"
                  style={S.dangerBtn}
                  disabled={cancelling || confirming}
                  onClick={() => {
                    if (
                      window.confirm(
                        t('admin.purchaseOrders.confirmCancelPrompt'),
                      )
                    ) {
                      onCancel(row.id);
                    }
                  }}
                >
                  {cancelling
                    ? t('admin.purchaseOrders.cancelling')
                    : t('admin.purchaseOrders.cancelDraft')}
                </button>
                <button
                  type="button"
                  style={S.primaryBtn}
                  disabled={
                    confirming ||
                    cancelling ||
                    (detail.items?.length ?? 0) === 0
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        t('admin.purchaseOrders.confirmConfirmPrompt'),
                      )
                    ) {
                      onConfirm(row.id);
                    }
                  }}
                  title={
                    (detail.items?.length ?? 0) === 0
                      ? t('admin.purchaseOrders.confirmNeedsItems')
                      : undefined
                  }
                >
                  {confirming
                    ? t('admin.purchaseOrders.confirming')
                    : t('admin.purchaseOrders.confirmDraft')}
                </button>
              </>
            ) : (
              <span style={S.expandFootHint}>
                {row.status === 'CONFIRMED'
                  ? t('admin.purchaseOrders.confirmedHint')
                  : t('admin.purchaseOrders.cancelledHint')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Short reference: "PO-220" style is overkill; use the time on the supplier's
// receipt day. Helps the operator disambiguate two POs to the same supplier
// on the same day without inventing identifiers.
function shortRef(p: PurchaseDetail): string {
  const d = new Date(p.date);
  if (Number.isNaN(d.getTime())) return p.id.slice(0, 6);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Color buckets — VERIFIED (terminal success) and CONFIRMED (legacy alias)
// share green; mid-flight states share gold; rejected/cancelled share muted.
function statusBucket(status: PurchaseStatus): 'gold' | 'green' | 'muted' | 'red' | 'blue' {
  switch (status) {
    case 'DRAFT':
      return 'gold';
    case 'SENT_TO_SUPPLIER':
    case 'IN_TRANSIT':
      return 'blue';
    case 'SUPPLIER_REPLIED':
    case 'ARRIVED':
    case 'DISPATCHED':
    case 'RETURNED':
      return 'gold';
    case 'PAID':
    case 'VERIFIED':
    case 'CONFIRMED':
      return 'green';
    case 'REJECTED':
      return 'red';
    case 'CANCELLED':
    default:
      return 'muted';
  }
}

function StatusDot({ status }: { status: PurchaseStatus }) {
  const bucket = statusBucket(status);
  const color =
    bucket === 'gold' ? 'var(--gold)'
      : bucket === 'green' ? 'var(--green)'
        : bucket === 'red' ? 'var(--red)'
          : bucket === 'blue' ? '#2a6ac8'
            : 'var(--text3)';
  return <span style={{ ...S.statusDot, background: color }} />;
}

const STATUS_I18N: Record<PurchaseStatus, string> = {
  DRAFT: 'admin.purchaseOrders.status.draft',
  SENT_TO_SUPPLIER: 'admin.purchaseOrders.status.sent',
  SUPPLIER_REPLIED: 'admin.purchaseOrders.status.replied',
  PAID: 'admin.purchaseOrders.status.paid',
  IN_TRANSIT: 'admin.purchaseOrders.status.inTransit',
  ARRIVED: 'admin.purchaseOrders.status.arrived',
  DISPATCHED: 'admin.purchaseOrders.status.dispatched',
  RETURNED: 'admin.purchaseOrders.status.returned',
  VERIFIED: 'admin.purchaseOrders.status.verified',
  REJECTED: 'admin.purchaseOrders.status.rejected',
  CANCELLED: 'admin.purchaseOrders.status.cancelled',
  CONFIRMED: 'admin.purchaseOrders.status.confirmed',
};

function StatusPill({ status }: { status: PurchaseStatus }) {
  const { t } = useTranslation();
  const bucket = statusBucket(status);
  const tint =
    bucket === 'gold' ? S.badgeGold
      : bucket === 'green' ? S.badgeGreen
        : S.badgeMuted;
  return <span style={{ ...S.badge, ...tint }}>{t(STATUS_I18N[status])}</span>;
}

// ─── Items subgrid (inline expansion body) ─────────────────────────────────

const ITEM_COLS = '1.4fr 1fr 80px 110px 110px';

function ItemsSubgrid({
  items,
  loading,
}: {
  items: PurchaseItemRow[];
  loading: boolean;
}) {
  const { t } = useTranslation();

  if (loading && items.length === 0) {
    return (
      <div style={{ ...S.center, padding: '20px 0' }}>
        <Spinner />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={S.subgridEmpty}>
        {t('admin.purchaseOrders.detail.emptyItems')}
      </div>
    );
  }

  return (
    <div style={S.subgrid}>
      <div style={{ ...S.subgridHead, gridTemplateColumns: ITEM_COLS }}>
        <span>{t('admin.purchaseOrders.detail.colSupply')}</span>
        <span>{t('admin.purchaseOrders.detail.colPackaging')}</span>
        <span style={S.alignRight}>
          {t('admin.purchaseOrders.detail.colQty')}
        </span>
        <span style={S.alignRight}>
          {t('admin.purchaseOrders.detail.colPrice')}
        </span>
        <span style={S.alignRight}>
          {t('admin.purchaseOrders.detail.colSubtotal')}
        </span>
      </div>
      {items.map((it) => {
        const subtotal = new Decimal(it.package_quantity)
          .mul(new Decimal(it.price_per_package))
          .toNumber();
        return (
          <div
            key={it.id}
            style={{ ...S.subgridRow, gridTemplateColumns: ITEM_COLS }}
          >
            <span style={S.itemName}>{it.supply?.name ?? '—'}</span>
            <span style={S.itemPackaging}>{it.packaging?.name ?? '—'}</span>
            <span style={S.numRight}>
              {new Decimal(it.package_quantity).toString()}
            </span>
            <span style={{ ...S.numRight, color: 'var(--text2)' }}>
              {formatMoney(it.price_per_package)}
            </span>
            <span style={{ ...S.numRight, fontWeight: 600 }}>
              {formatMoney(subtotal)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div style={S.empty}>
      <IconClipboard
        style={{ fontSize: 36, color: 'var(--text3)', marginBottom: 12 }}
      />
      <div style={S.emptyTitle}>{t('admin.purchaseOrders.empty.title')}</div>
      <div style={S.emptySub}>{t('admin.purchaseOrders.empty.subtitle')}</div>
    </div>
  );
}

// ─── Compose pane ──────────────────────────────────────────────────────────

interface ComposeProps {
  onCancel: () => void;
  onSaved: (msg: string) => void;
}

function ComposePane({ onCancel, onSaved }: ComposeProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState('');
  const [storageId, setStorageId] = useState('');
  const [date, setDate] = useState<string>(todayInputValue());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ['suppliers', { active: true }],
    queryFn: () => listSuppliers({ active: true }),
    staleTime: 5 * 60_000,
  });
  const suppliers = suppliersQuery.data ?? [];

  const storagesQuery = useQuery({
    queryKey: ['storages', { active: true }],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });
  const storages = storagesQuery.data ?? [];

  // Default receiving storage to the first active one — operators almost
  // always book POs against their main warehouse.
  useEffect(() => {
    if (!storageId && storages.length > 0) {
      setStorageId(storages[0].id);
    }
  }, [storages, storageId]);

  useEffect(() => {
    setErrorBanner(null);
  }, [supplierId, storageId, lines.length]);

  function patchLine(uidV: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.uid === uidV ? { ...l, ...patch } : l)));
  }

  function removeLine(uidV: string) {
    setLines((prev) => prev.filter((l) => l.uid !== uidV));
  }

  async function loadPackagingsFor(
    lineUid: string,
    supplyIdToUse: string,
    supplierIdToUse: string,
  ) {
    patchLine(lineUid, { packagingsLoading: true });
    try {
      const list = await listPackagings({
        supply_id: supplyIdToUse,
        supplier_id: supplierIdToUse,
        active: true,
        limit: 50,
      });
      const primary = list.find((p) => p.is_primary) ?? list[0];
      patchLine(lineUid, {
        packagings: list,
        packagingsLoading: false,
        packagingId: primary?.id ?? null,
        pricePerPackagePesos:
          primary?.price_per_package != null
            ? (Number(primary.price_per_package) / 100).toString()
            : '',
      });
    } catch {
      patchLine(lineUid, { packagingsLoading: false });
    }
  }

  function addSupply(supply: SupplySearchResult) {
    if (lines.some((l) => l.supplyId === supply.id)) return;
    const line: DraftLine = {
      uid: uid(),
      supplyId: supply.id,
      supplyName: supply.name,
      baseUnit: supply.base_unit,
      packagings: [],
      packagingsLoading: false,
      packagingId: null,
      packageQuantity: '1',
      pricePerPackagePesos: '',
    };
    setLines((prev) => [...prev, line]);
    if (supplierId) {
      void loadPackagingsFor(line.uid, supply.id, supplierId);
    }
  }

  // When supplier changes, every line's packaging set is now invalid — refetch
  // each. If supplier is cleared, blank the packaging selects but keep the
  // supplies (the operator may be re-targeting a different vendor for the
  // same shopping list).
  useEffect(() => {
    if (lines.length === 0) return;
    if (!supplierId) {
      setLines((prev) =>
        prev.map((l) => ({
          ...l,
          packagings: [],
          packagingId: null,
          pricePerPackagePesos: '',
        })),
      );
      return;
    }
    for (const line of lines) {
      void loadPackagingsFor(line.uid, line.supplyId, supplierId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  const runningTotal = useMemo(
    () => lines.reduce((sum, l) => sum + lineTotalCentavos(l), 0),
    [lines],
  );

  const submitMutation = useMutation({
    mutationFn: (input: CreatePurchaseInput) => createPurchase(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-purchases'] });
      onSaved(t('admin.purchaseOrders.savedDraft'));
    },
    onError: (err) => {
      setErrorBanner(
        err instanceof ApiError ? err.message : t('error.somethingWrong'),
      );
    },
  });

  function submit() {
    setErrorBanner(null);
    if (!supplierId) {
      setErrorBanner(t('admin.purchaseOrders.errorPickSupplier'));
      return;
    }
    if (!storageId) {
      setErrorBanner(t('admin.purchaseOrders.errorPickStorage'));
      return;
    }
    if (lines.length === 0) {
      setErrorBanner(t('admin.purchaseOrders.errorNoLines'));
      return;
    }
    const items = lines
      .filter((l) => safeNum(l.packageQuantity) > 0)
      .map((l) => ({
        supply_id: l.supplyId,
        packaging_id: l.packagingId,
        package_quantity: safeNum(l.packageQuantity),
        price_per_package: Math.round(
          safeNum(l.pricePerPackagePesos) * 100,
        ),
      }));
    if (items.length === 0) {
      setErrorBanner(t('admin.purchaseOrders.errorNoLines'));
      return;
    }
    submitMutation.mutate({
      supplier_id: supplierId,
      storage_id: storageId,
      // Noon-local ISO so timezone drift never bumps the displayed day.
      date: new Date(`${date}T12:00:00`).toISOString(),
      notes: notes.trim() || undefined,
      items,
    });
  }

  return (
    <div style={S.composeScroll}>
      <div style={S.composeForm}>
        <section style={S.composeBlock}>
          <h3 style={S.blockTitle}>
            {t('admin.purchaseOrders.compose.header')}
          </h3>
          <div style={S.headerGrid}>
            <label style={S.field}>
              <span style={S.eyebrow}>
                {t('admin.purchaseOrders.compose.supplier')}
              </span>
              <select
                style={S.select}
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">
                  {t('admin.purchaseOrders.compose.pickSupplier')}
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={S.field}>
              <span style={S.eyebrow}>
                {t('admin.purchaseOrders.compose.receivingAt')}
              </span>
              <select
                style={S.select}
                value={storageId}
                onChange={(e) => setStorageId(e.target.value)}
              >
                {storages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={S.field}>
              <span style={S.eyebrow}>
                {t('admin.purchaseOrders.compose.date')}
              </span>
              <input
                type="date"
                style={S.dateInput}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
        </section>

        <section style={S.composeBlock}>
          <div style={S.blockHead}>
            <h3 style={S.blockTitle}>
              {t('admin.purchaseOrders.compose.lines')}
            </h3>
            <span style={S.blockSub}>
              {lines.length === 0
                ? t('admin.purchaseOrders.compose.linesHintEmpty')
                : t('admin.purchaseOrders.compose.linesHint').replace(
                    '{n}',
                    String(lines.length),
                  )}
            </span>
          </div>

          <SupplyPicker
            onPick={addSupply}
            existingIds={new Set(lines.map((l) => l.supplyId))}
            disabled={false}
          />

          {lines.length > 0 && (
            <div style={S.linesList}>
              {lines.map((line, idx) => (
                <DraftLineRow
                  key={line.uid}
                  index={idx}
                  line={line}
                  supplierPicked={Boolean(supplierId)}
                  onPatch={(patch) => patchLine(line.uid, patch)}
                  onRemove={() => removeLine(line.uid)}
                />
              ))}
            </div>
          )}
        </section>

        <section style={S.composeBlock}>
          <h3 style={S.blockTitle}>
            {t('admin.purchaseOrders.compose.notes')}
          </h3>
          <textarea
            style={S.textarea}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('admin.purchaseOrders.compose.notesPh')}
            maxLength={2000}
          />
        </section>

        {errorBanner && <div style={S.bannerErr}>{errorBanner}</div>}

        <div style={S.composeFoot}>
          <div style={S.totalBlock}>
            <span style={S.eyebrow}>
              {t('admin.purchaseOrders.compose.total')}
            </span>
            <span style={S.totalValue}>{formatMoney(runningTotal)}</span>
          </div>
          <div style={S.composeFootActions}>
            <button type="button" style={S.ghostBtn} onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              style={S.primaryBtn}
              disabled={submitMutation.isPending || lines.length === 0}
              onClick={submit}
            >
              {submitMutation.isPending
                ? t('admin.purchaseOrders.compose.saving')
                : t('admin.purchaseOrders.compose.saveDraft')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Supply picker (search-as-you-type) ────────────────────────────────────

interface SupplyPickerProps {
  onPick: (s: SupplySearchResult) => void;
  existingIds: Set<string>;
  disabled: boolean;
}

function SupplyPicker({ onPick, existingIds, disabled }: SupplyPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Debounce so we don't hit the server on every keystroke.
  useEffect(() => {
    const tm = window.setTimeout(() => setDebounced(query.trim()), 180);
    return () => window.clearTimeout(tm);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ['admin-supply-search', debounced],
    queryFn: () => searchSupplies(debounced, 12),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });
  const results = searchQuery.data ?? [];

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  function handlePick(s: SupplySearchResult) {
    if (existingIds.has(s.id)) return;
    onPick(s);
    setQuery('');
    setDebounced('');
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={S.pickerWrap}>
      <div style={S.pickerInputRow}>
        <IconSearch style={{ fontSize: 14, color: 'var(--text3)' }} />
        <input
          type="search"
          style={S.pickerInput}
          placeholder={t('admin.purchaseOrders.compose.supplyPh')}
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {searchQuery.isFetching && debounced && (
          <span style={S.pickerSpinner}>
            <Spinner />
          </span>
        )}
      </div>
      {open && debounced && (
        <div style={S.pickerDropdown}>
          {searchQuery.isLoading ? (
            <div style={{ ...S.center, padding: 18 }}>
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <div style={S.pickerEmpty}>
              {t('admin.purchaseOrders.compose.supplyNoResults')}
            </div>
          ) : (
            results.map((r) => {
              const already = existingIds.has(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  style={{
                    ...S.pickerOption,
                    opacity: already ? 0.45 : 1,
                    cursor: already ? 'default' : 'pointer',
                  }}
                  disabled={already}
                  onClick={() => handlePick(r)}
                >
                  <span style={S.pickerOptionName}>{r.name}</span>
                  <span style={S.pickerOptionMeta}>
                    {r.base_unit.toLowerCase()}
                    {already
                      ? ` · ${t('admin.purchaseOrders.compose.supplyAlready')}`
                      : ''}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Draft line row ────────────────────────────────────────────────────────

interface DraftLineRowProps {
  index: number;
  line: DraftLine;
  supplierPicked: boolean;
  onPatch: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}

function DraftLineRow({
  index,
  line,
  supplierPicked,
  onPatch,
  onRemove,
}: DraftLineRowProps) {
  const { t } = useTranslation();
  const subtotal = lineTotalCentavos(line);

  return (
    <div style={S.lineRow}>
      <div style={S.lineRowHead}>
        <span style={S.lineIndex}>{String(index + 1).padStart(2, '0')}</span>
        <span style={S.lineName}>{line.supplyName}</span>
        <button
          type="button"
          style={S.lineTrash}
          onClick={onRemove}
          aria-label={t('common.remove')}
        >
          <IconTrash style={{ fontSize: 14 }} />
        </button>
      </div>

      <div style={S.lineGrid}>
        <label style={{ ...S.field, gridColumn: '1 / -1' }}>
          <span style={S.eyebrowSm}>
            {t('admin.purchaseOrders.compose.packaging')}
          </span>
          <select
            style={S.selectSm}
            value={line.packagingId ?? ''}
            disabled={!supplierPicked || line.packagingsLoading}
            onChange={(e) => {
              const id = e.target.value || null;
              const pkg = line.packagings.find((p) => p.id === id);
              onPatch({
                packagingId: id,
                pricePerPackagePesos:
                  pkg?.price_per_package != null
                    ? (Number(pkg.price_per_package) / 100).toString()
                    : line.pricePerPackagePesos,
              });
            }}
          >
            <option value="">
              {!supplierPicked
                ? t('admin.purchaseOrders.compose.packagingNeedsSupplier')
                : line.packagingsLoading
                  ? t('admin.purchaseOrders.compose.packagingLoading')
                  : line.packagings.length === 0
                    ? t('admin.purchaseOrders.compose.packagingNone')
                    : t('admin.purchaseOrders.compose.packagingPick')}
            </option>
            {line.packagings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label style={S.field}>
          <span style={S.eyebrowSm}>
            {t('admin.purchaseOrders.compose.qty')}
          </span>
          <input
            type="number"
            min={0}
            step={0.0001}
            style={S.numInput}
            value={line.packageQuantity}
            onChange={(e) => onPatch({ packageQuantity: e.target.value })}
          />
        </label>
        <label style={S.field}>
          <span style={S.eyebrowSm}>
            {t('admin.purchaseOrders.compose.pricePerPkg')}
          </span>
          <input
            type="number"
            min={0}
            step={0.01}
            style={S.numInput}
            value={line.pricePerPackagePesos}
            onChange={(e) => onPatch({ pricePerPackagePesos: e.target.value })}
          />
        </label>
      </div>

      <div style={S.lineSubtotal}>
        <span style={S.eyebrowSm}>
          {t('admin.purchaseOrders.compose.subtotal')}
        </span>
        <span style={S.lineSubtotalVal}>{formatMoney(subtotal)}</span>
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const eyebrow: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 600,
};

const S: Record<string, CSSProperties> = {
  // Mode switcher + header actions
  modeBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  segment: {
    display: 'inline-flex',
    padding: 3,
    borderRadius: 999,
    background: 'var(--bg)',
    border: '1px solid var(--border)',
  },
  segmentBtn: {
    height: 34,
    padding: '0 16px',
    borderRadius: 999,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--text2)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 140ms cubic-bezier(0.22, 1, 0.36, 1)',
    minHeight: 34,
  },
  segmentBtnOn: {
    height: 34,
    padding: '0 16px',
    borderRadius: 999,
    border: '1px solid var(--text1)',
    background: 'var(--text1)',
    color: '#f6efe2',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 140ms cubic-bezier(0.22, 1, 0.36, 1)',
    minHeight: 34,
  },
  newCta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 40,
    padding: '0 16px',
    borderRadius: 10,
    border: '1px solid rgba(44,36,32,0.08)',
    background: 'var(--gold)',
    color: '#2c2420',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 40,
    transition: 'transform 120ms ease-out',
  },

  // Ledger pane
  ledgerPane: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    minHeight: 0,
    flex: 1,
  },
  flashOk: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    margin: '14px 32px 0',
    padding: '10px 14px',
    borderRadius: 10,
    background: 'rgba(74,140,92,0.10)',
    border: '1px solid rgba(74,140,92,0.30)',
    color: 'var(--green)',
    fontSize: 13,
    fontWeight: 500,
  },
  flashClose: {
    marginLeft: 4,
    background: 'transparent',
    border: 'none',
    color: 'var(--green)',
    cursor: 'pointer',
    padding: 4,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    minHeight: 24,
  },

  filterStrip: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 16,
    padding: '14px 32px',
    borderBottom: '1px solid var(--border)',
  },
  statusPills: {
    display: 'inline-flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  pill: {
    height: 38,
    padding: '0 14px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text2)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 120ms ease-out',
    minHeight: 38,
  },
  pillOn: {
    height: 38,
    padding: '0 14px',
    borderRadius: 999,
    border: '1px solid var(--text1)',
    background: 'var(--text1)',
    color: '#f6efe2',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 120ms ease-out',
    minHeight: 38,
  },
  fieldInline: { display: 'flex', flexDirection: 'column', gap: 4 },
  eyebrow,
  eyebrowSm: { ...eyebrow, fontSize: 9, letterSpacing: '0.12em' },

  select: {
    height: 38,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '0 10px',
    fontFamily: 'inherit',
    fontSize: 13,
    minWidth: 200,
  },
  selectSm: {
    height: 36,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '0 8px',
    fontFamily: 'inherit',
    fontSize: 13,
  },
  dateInput: {
    height: 38,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '0 10px',
    fontFamily: 'inherit',
    fontSize: 13,
    minWidth: 150,
  },

  kpiStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 0,
    padding: '20px 32px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
  },
  kpi: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    paddingRight: 18,
    borderRight: '1px solid var(--border)',
  },
  kpiLabel: { ...eyebrow },
  kpiValue: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 28,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  },

  bannerErr: {
    margin: '14px 32px 0',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    background: 'rgba(196,80,64,0.08)',
    color: 'var(--red)',
    border: '1px solid rgba(196,80,64,0.30)',
  },

  ledgerScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '12px 32px 32px',
  },
  daySection: { marginBottom: 24 },
  dayHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: '14px 4px 10px',
    borderBottom: '1px solid var(--border)',
    marginBottom: 4,
  },
  dayTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  dayMeta: {
    fontSize: 12,
    color: 'var(--text3)',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
    letterSpacing: '0.04em',
  },
  dayList: { display: 'flex', flexDirection: 'column' },

  rowWrap: {
    borderBottom: '1px solid var(--border)',
  },
  row: {
    display: 'grid',
    width: '100%',
    gap: 14,
    padding: '14px 4px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text1)',
    fontFamily: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    alignItems: 'center',
    transition: 'background 120ms ease-out',
    minHeight: 56,
    fontSize: 13,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'inline-block',
  },
  rowSupplyCol: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  rowSupplier: {
    fontWeight: 600,
    color: 'var(--text1)',
    fontSize: 14,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowSubtle: {
    color: 'var(--text3)',
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowTotal: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  numRight: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  alignRight: { textAlign: 'right' },

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 9px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    border: '1px solid',
  },
  badgeGold: {
    color: 'var(--gold)',
    background: 'rgba(201,164,92,0.12)',
    borderColor: 'rgba(201,164,92,0.40)',
  },
  badgeGreen: {
    color: 'var(--green)',
    background: 'rgba(74,140,92,0.10)',
    borderColor: 'rgba(74,140,92,0.40)',
  },
  badgeMuted: {
    color: 'var(--text3)',
    background: 'rgba(168,152,136,0.10)',
    borderColor: 'rgba(168,152,136,0.40)',
  },

  rowExpand: {
    padding: '4px 4px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  subgrid: {
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg2)',
    overflow: 'hidden',
  },
  subgridHead: {
    display: 'grid',
    gap: 14,
    padding: '10px 14px',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  subgridRow: {
    display: 'grid',
    gap: 14,
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  },
  subgridEmpty: {
    padding: '20px 18px',
    color: 'var(--text3)',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    border: '1px dashed var(--border)',
    borderRadius: 10,
    background: 'var(--bg)',
  },
  itemName: { fontWeight: 500, color: 'var(--text1)' },
  itemPackaging: { color: 'var(--text2)' },

  notesBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '12px 14px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
  },
  notesText: {
    margin: 0,
    fontSize: 13,
    color: 'var(--text2)',
    lineHeight: 1.55,
  },

  expandFoot: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
  },
  expandFootHint: {
    fontSize: 12,
    color: 'var(--text3)',
    fontStyle: 'italic',
  },

  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 22px',
    height: 48,
    minHeight: 48,
    borderRadius: 10,
    border: '1px solid var(--text1)',
    background: 'var(--text1)',
    color: '#f6efe2',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.01em',
    transition: 'transform 120ms ease-out, opacity 120ms ease-out',
  },
  ghostBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 18px',
    height: 44,
    minHeight: 44,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  dangerBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 16px',
    height: 44,
    minHeight: 44,
    borderRadius: 10,
    border: '1px solid rgba(196,80,64,0.30)',
    background: 'transparent',
    color: 'var(--red)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },

  // Compose
  composeScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '28px 32px 40px',
  },
  composeForm: {
    maxWidth: 840,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
  },
  composeBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  blockHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  blockTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
  },
  blockSub: {
    fontSize: 12,
    color: 'var(--text3)',
  },
  headerGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) 160px',
    gap: 12,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },

  pickerWrap: {
    position: 'relative',
  },
  pickerInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: 46,
    padding: '0 14px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg2)',
  },
  pickerInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: 14,
    color: 'var(--text1)',
  },
  pickerSpinner: { display: 'inline-flex', alignItems: 'center' },
  pickerDropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: 'var(--shadow-lg)',
    maxHeight: 320,
    overflowY: 'auto',
    zIndex: 20,
  },
  pickerOption: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 14px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text1)',
    fontFamily: 'inherit',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    minHeight: 44,
    transition: 'background 100ms ease-out',
  },
  pickerOptionName: { fontWeight: 500, color: 'var(--text1)' },
  pickerOptionMeta: {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  pickerEmpty: {
    padding: '18px 14px',
    fontSize: 13,
    color: 'var(--text3)',
    textAlign: 'center',
    fontStyle: 'italic',
  },

  linesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  lineRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '14px 16px 12px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg2)',
  },
  lineRowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  lineIndex: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text3)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.04em',
    width: 24,
    flexShrink: 0,
  },
  lineName: {
    flex: 1,
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--text1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  lineTrash: {
    width: 32,
    height: 32,
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--text3)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
    transition: 'color 120ms ease-out, background 120ms ease-out',
  },
  lineGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 140px 160px',
    gap: 10,
  },
  numInput: {
    height: 36,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg)',
    color: 'var(--text1)',
    padding: '0 10px',
    fontFamily: 'inherit',
    fontSize: 13,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  lineSubtotal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 6,
    borderTop: '1px solid var(--border)',
  },
  lineSubtotalVal: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },

  textarea: {
    width: '100%',
    minHeight: 72,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: 13,
    resize: 'vertical',
    outline: 'none',
  },

  composeFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingTop: 18,
    borderTop: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  totalBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  totalValue: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 32,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  },
  composeFootActions: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },

  // Empty state
  empty: {
    padding: '72px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text2)',
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 13,
    color: 'var(--text3)',
  },

  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
  },
};
