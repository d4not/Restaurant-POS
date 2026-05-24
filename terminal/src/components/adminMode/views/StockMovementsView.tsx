// Inventory · Stock movements — read-only audit log of every supply change.
//
// Backed by GET /api/v1/stock-movements. The operator opens this view to
// answer "what moved today, and why" — verifying purchases, transfers,
// write-offs, adjustments and sale deductions land where they should.
//
// Layout
//   ┌─ Filter bar (type chips · storage select · supply search · range) ┐
//   ┌─ KPI strip (count · inflows · outflows · net cost impact) ────────┐
//   ┌─ Day group → table (time · type · supply · storage · qty · cost) ─┐
//
// Pagination is cursor-based with an explicit "Load more" button. We keep
// previous data on filter changes so the table doesn't flash empty between
// keystrokes.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import {
  listStockMovements,
  type StockMovementRow,
  type StockMovementType,
  type ListStockMovementParams,
} from '../../../api/stock-movements';
import { listStorages, type Storage } from '../../../api/storages';
import {
  searchSupplies,
  type SupplySearchResult,
} from '../../../api/supplies';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { formatMoneyPlain } from '../../../utils/format';
import { Spinner } from '../../Spinner';

interface Props {
  onBack: () => void;
}

type RangePreset = 'today' | '7d' | '30d' | 'custom';

const PAGE_SIZE = 50;

const ALL_TYPES: readonly StockMovementType[] = [
  'PURCHASE',
  'SALE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'WRITE_OFF',
  'ADJUSTMENT',
  'MANUFACTURE',
] as const;

// ─── Type styling map ──────────────────────────────────────────────────
// Each movement type carries its own visual register. The rules:
//   • Inflows lean green; outflows lean towards their semantic colour
//     (red = loss, neutral = expected sale, gold = paired transfer).
//   • ADJUSTMENT uses a dashed border to telegraph "human touch" — these
//     rows are the ones an auditor scrutinises first.
//   • SALE deliberately reads quiet: it's the most common movement and
//     shouldn't steal attention from the unusual ones.
interface TypeStyle {
  bg: string;
  color: string;
  border: string;
  borderStyle: CSSProperties['borderStyle'];
}

const TYPE_STYLES: Record<StockMovementType, TypeStyle> = {
  PURCHASE: {
    bg: 'rgba(74,140,92,0.14)',
    color: 'var(--green)',
    border: 'rgba(74,140,92,0.4)',
    borderStyle: 'solid',
  },
  SALE: {
    bg: 'rgba(168,152,136,0.16)',
    color: 'var(--text2)',
    border: 'rgba(168,152,136,0.4)',
    borderStyle: 'solid',
  },
  TRANSFER_IN: {
    bg: 'rgba(201,164,92,0.18)',
    color: '#8a6d2a',
    border: 'rgba(201,164,92,0.55)',
    borderStyle: 'solid',
  },
  TRANSFER_OUT: {
    bg: 'transparent',
    color: '#8a6d2a',
    border: 'rgba(201,164,92,0.65)',
    borderStyle: 'solid',
  },
  WRITE_OFF: {
    bg: 'rgba(196,80,64,0.12)',
    color: 'var(--red)',
    border: 'rgba(196,80,64,0.45)',
    borderStyle: 'solid',
  },
  ADJUSTMENT: {
    bg: 'transparent',
    color: '#8a6d2a',
    border: 'rgba(201,164,92,0.7)',
    borderStyle: 'dashed',
  },
  MANUFACTURE: {
    bg: 'rgba(58,86,107,0.12)',
    color: '#3a566b',
    border: 'rgba(58,86,107,0.45)',
    borderStyle: 'solid',
  },
};

// ─── Date helpers ──────────────────────────────────────────────────────

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfTodayIso(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function isoFromInput(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Strip the trailing UUID from a reference id for the audit pill — full
// UUIDs are noise next to the human-readable type. We keep the first 8 to
// give the operator something to search on if they pop a DB tool open.
function shortRefId(id: string): string {
  if (!id) return '';
  return id.slice(0, 8);
}

// Convert a Prisma Decimal-as-string quantity to a friendly number string.
// Quantities can run 4 decimals (e.g. 0.2114 bottles). Trim trailing zeros
// so 1.0000 reads "1" but 0.2114 stays full. Stripping decimals beyond 4
// keeps the column width predictable.
function fmtQty(qty: string): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return qty;
  const abs = Math.abs(n);
  // Pick precision adaptively — integers and stock-counted units stay
  // tidy; partial decimals show what they actually are.
  const fixed = abs >= 100 ? n.toFixed(0) : abs >= 1 ? n.toFixed(3) : n.toFixed(4);
  return fixed.replace(/\.?0+$/, '');
}

// Cost impact in centavos = quantity * unit_cost. Both fields are signed:
// quantity carries the +/− direction, unit_cost is non-negative. So the
// sign of the product follows quantity.
function costImpactCents(qty: string, unitCost: string): Decimal {
  return new Decimal(qty).mul(new Decimal(unitCost));
}

// ─── Component ─────────────────────────────────────────────────────────

export function StockMovementsView({ onBack }: Props) {
  const { t } = useTranslation();

  const [types, setTypes] = useState<Set<StockMovementType>>(new Set());
  const [storageId, setStorageId] = useState<string>('');
  const [supply, setSupply] = useState<SupplySearchResult | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset>('7d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  // Range computation — preset wins unless we're on "custom", in which
  // case we take the date inputs (empty inputs = no bound).
  const range = useMemo<{ from?: string; to?: string }>(() => {
    if (rangePreset === 'today') {
      return { from: startOfTodayIso(), to: endOfTodayIso() };
    }
    if (rangePreset === '7d') {
      return { from: daysAgoIso(6), to: endOfTodayIso() };
    }
    if (rangePreset === '30d') {
      return { from: daysAgoIso(29), to: endOfTodayIso() };
    }
    return {
      from: isoFromInput(customFrom),
      to: isoFromInput(customTo, true),
    };
  }, [rangePreset, customFrom, customTo]);

  // Storages — small list, fetched once. Used to populate the storage
  // dropdown. Failures here aren't fatal: the filter just degrades.
  const storagesQuery = useQuery({
    queryKey: ['storages-all'],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });

  // Build the query params. We treat the empty-types set as "no filter"
  // (backend interprets the absence of `type` as "all kinds"), which is
  // what the user means when no chips are active.
  const baseParams = useMemo<ListStockMovementParams>(() => {
    const out: ListStockMovementParams = { limit: PAGE_SIZE };
    if (types.size > 0) out.type = Array.from(types);
    if (storageId) out.storage_id = storageId;
    if (supply) out.supply_id = supply.id;
    if (range.from) out.from = range.from;
    if (range.to) out.to = range.to;
    return out;
  }, [types, storageId, supply, range]);

  // Cursor pagination handled manually so the user can "Load more" without
  // surprise refetches. We accumulate pages locally; React Query supplies
  // the dedupe + retries.
  const [pages, setPages] = useState<StockMovementRow[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Whenever the filter set changes, blow away the accumulated pages and
  // refetch from the top. A monotonically-increasing key bound to the
  // params drives React Query's caching for us.
  const filterKey = useMemo(() => JSON.stringify(baseParams), [baseParams]);
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      setPages([]);
      setCursor(null);
    }
  }, [filterKey]);

  const pageQuery = useQuery({
    queryKey: ['stock-movements', filterKey, cursor],
    queryFn: () =>
      listStockMovements({
        ...baseParams,
        ...(cursor ? { cursor } : {}),
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  // Fold every successful page into our local store. We key the dedupe by
  // page-cursor so a refetch of the same cursor replaces the existing
  // slice rather than appending duplicates.
  const lastAppliedRef = useRef<{ key: string; cursor: string | null }>({
    key: '',
    cursor: null,
  });
  useEffect(() => {
    if (!pageQuery.data) return;
    const applied = lastAppliedRef.current;
    if (applied.key === filterKey && applied.cursor === cursor) return;
    lastAppliedRef.current = { key: filterKey, cursor };
    setPages((prev) => {
      if (cursor === null) return [pageQuery.data!.items];
      return [...prev, pageQuery.data!.items];
    });
    setNextCursor(pageQuery.data.nextCursor);
  }, [pageQuery.data, filterKey, cursor]);

  const rows = useMemo(() => pages.flat(), [pages]);

  // KPI math runs across only the loaded rows. We surface this honestly
  // by labelling the count with a "+" when more pages remain — the
  // operator should never think they're looking at the period total when
  // they're actually looking at the first page.
  const kpis = useMemo(() => {
    let inflowCount = 0;
    let outflowCount = 0;
    let net = new Decimal(0);
    for (const row of rows) {
      const impact = costImpactCents(row.quantity, row.unit_cost);
      net = net.plus(impact);
      const qty = new Decimal(row.quantity);
      if (qty.isZero()) continue;
      if (qty.isPositive()) inflowCount += 1;
      else outflowCount += 1;
    }
    return {
      count: rows.length,
      inflows: inflowCount,
      outflows: outflowCount,
      net: net.toString(),
    };
  }, [rows]);

  // Group rows by local calendar day. Pages already come back time-desc
  // so order is preserved — Map preserves insertion order.
  const grouped = useMemo(() => {
    const out = new Map<string, { label: string; rows: StockMovementRow[] }>();
    for (const row of rows) {
      const key = dayKey(row.created_at);
      let bucket = out.get(key);
      if (!bucket) {
        bucket = { label: dayLabel(row.created_at), rows: [] };
        out.set(key, bucket);
      }
      bucket.rows.push(row);
    }
    return Array.from(out.entries());
  }, [rows]);

  function toggleType(t: StockMovementType): void {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function clearAllFilters(): void {
    setTypes(new Set());
    setStorageId('');
    setSupply(null);
    setRangePreset('7d');
    setCustomFrom('');
    setCustomTo('');
  }

  function loadMore(): void {
    if (!nextCursor) return;
    setCursor(nextCursor);
  }

  const hasAnyFilter =
    types.size > 0 ||
    Boolean(storageId) ||
    Boolean(supply) ||
    rangePreset === 'custom' ||
    rangePreset === 'today';

  const isFirstLoad = pageQuery.isLoading && rows.length === 0;
  const isFetchingMore = pageQuery.isFetching && cursor !== null;
  const showInitialEmpty =
    !pageQuery.isLoading && rows.length === 0 && !hasAnyFilter;
  const showFilteredEmpty =
    !pageQuery.isLoading && rows.length === 0 && hasAnyFilter;

  return (
    <AdminViewShell
      titleKey="admin.stockMovements.title"
      subtitleKey="admin.stockMovements.subtitle"
      onBack={onBack}
    >
      {/* ─── Filter bar ───────────────────────────────────────────── */}
      <div style={filterBarStyle}>
        <div style={filterGroupStyle}>
          <span style={adminStyles.filterLabel}>
            {t('admin.stockMovements.filter.type')}
          </span>
          <div style={typeChipRowStyle}>
            {ALL_TYPES.map((typeKey) => {
              const active = types.has(typeKey);
              const ts = TYPE_STYLES[typeKey];
              return (
                <button
                  key={typeKey}
                  type="button"
                  onClick={() => toggleType(typeKey)}
                  aria-pressed={active}
                  style={{
                    ...typeChipStyle,
                    color: active ? '#fff' : ts.color,
                    background: active ? ts.color : ts.bg,
                    borderColor: active ? ts.color : ts.border,
                    borderStyle: ts.borderStyle,
                  }}
                >
                  {t(`admin.stockMovements.type.${typeKey}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div style={filterRowSecondary}>
          <div style={filterFieldGrow}>
            <label htmlFor="sm-storage" style={adminStyles.filterLabel}>
              {t('admin.stockMovements.filter.storage')}
            </label>
            <select
              id="sm-storage"
              value={storageId}
              onChange={(e) => setStorageId(e.target.value)}
              style={selectStyle}
            >
              <option value="">
                {t('admin.stockMovements.filter.storageAll')}
              </option>
              {(storagesQuery.data ?? []).map((s: Storage) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div style={filterFieldGrowWide}>
            <label htmlFor="sm-supply" style={adminStyles.filterLabel}>
              {t('admin.stockMovements.filter.supply')}
            </label>
            <SupplyAutocomplete
              value={supply}
              onChange={setSupply}
              placeholder={t(
                'admin.stockMovements.filter.supplyPlaceholder',
              )}
            />
          </div>

          <div style={filterFieldShrink}>
            <span style={adminStyles.filterLabel}>
              {t('admin.stockMovements.filter.range')}
            </span>
            <div style={rangePillRow}>
              {(
                [
                  ['today', 'admin.stockMovements.filter.rangeToday'],
                  ['7d', 'admin.stockMovements.filter.range7d'],
                  ['30d', 'admin.stockMovements.filter.range30d'],
                  ['custom', 'admin.stockMovements.filter.rangeCustom'],
                ] as const
              ).map(([key, labelKey]) => {
                const active = rangePreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setRangePreset(key)}
                    style={{
                      ...adminStyles.pillBtn,
                      ...(active ? adminStyles.pillBtnActive : null),
                    }}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {rangePreset === 'custom' && (
          <div style={customDateRow}>
            <div style={filterFieldShrink}>
              <label htmlFor="sm-from" style={adminStyles.filterLabel}>
                {t('admin.stockMovements.filter.from')}
              </label>
              <input
                id="sm-from"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={adminStyles.dateInput}
              />
            </div>
            <div style={filterFieldShrink}>
              <label htmlFor="sm-to" style={adminStyles.filterLabel}>
                {t('admin.stockMovements.filter.to')}
              </label>
              <input
                id="sm-to"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={adminStyles.dateInput}
              />
            </div>
          </div>
        )}

        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAllFilters}
            style={clearFiltersBtn}
          >
            {t('admin.stockMovements.filter.clear')}
          </button>
        )}
      </div>

      {/* ─── KPI strip ────────────────────────────────────────────── */}
      <div style={adminStyles.kpiRow}>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>
            {t('admin.stockMovements.kpi.count')}
          </span>
          <span style={adminStyles.kpiValue}>
            {kpis.count}
            {nextCursor ? <span style={kpiPlusGlyph}>+</span> : null}
          </span>
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>
            {t('admin.stockMovements.kpi.inflows')}
          </span>
          <span style={{ ...adminStyles.kpiValue, color: 'var(--green)' }}>
            {kpis.inflows}
          </span>
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>
            {t('admin.stockMovements.kpi.outflows')}
          </span>
          <span style={{ ...adminStyles.kpiValue, color: 'var(--red)' }}>
            {kpis.outflows}
          </span>
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>
            {t('admin.stockMovements.kpi.netCost')}
          </span>
          <span
            style={{
              ...adminStyles.kpiValue,
              color: new Decimal(kpis.net).isZero()
                ? 'var(--text2)'
                : new Decimal(kpis.net).isNegative()
                  ? 'var(--red)'
                  : 'var(--green)',
            }}
          >
            {formatMoneyPlain(kpis.net)}
          </span>
        </div>
      </div>

      {/* ─── Body ─────────────────────────────────────────────────── */}
      {isFirstLoad ? (
        <div style={loadingWrap}>
          <Spinner />
        </div>
      ) : showInitialEmpty ? (
        <EmptyState
          title={t('admin.stockMovements.empty.title')}
          sub={t('admin.stockMovements.empty.sub')}
        />
      ) : showFilteredEmpty ? (
        <EmptyState
          title={t('admin.stockMovements.emptyFiltered.title')}
          sub={t('admin.stockMovements.emptyFiltered.sub')}
          action={
            <button
              type="button"
              onClick={clearAllFilters}
              style={emptyClearBtn}
            >
              {t('admin.stockMovements.filter.clear')}
            </button>
          }
        />
      ) : (
        <div style={logStack}>
          {grouped.map(([key, group]) => (
            <DayGroup key={key} label={group.label} rows={group.rows} />
          ))}

          <div style={footerWrap}>
            {nextCursor ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={isFetchingMore}
                style={{
                  ...loadMoreBtn,
                  opacity: isFetchingMore ? 0.7 : 1,
                  cursor: isFetchingMore ? 'progress' : 'pointer',
                }}
              >
                {isFetchingMore && <Spinner size={14} />}
                {t('admin.stockMovements.loadMore')}
              </button>
            ) : (
              <span style={endOfLog}>
                {t('admin.stockMovements.endOfLog')}
              </span>
            )}
          </div>
        </div>
      )}
    </AdminViewShell>
  );
}

// ─── Day group ─────────────────────────────────────────────────────────

interface DayGroupProps {
  label: string;
  rows: StockMovementRow[];
}

function DayGroup({ label, rows }: DayGroupProps) {
  const { t } = useTranslation();

  // Day-level totals: count + net cost. Quantities can't be summed safely
  // across mixed base units (kg vs piece), so we don't try.
  const { net } = useMemo(() => {
    let n = new Decimal(0);
    for (const r of rows) {
      n = n.plus(costImpactCents(r.quantity, r.unit_cost));
    }
    return { net: n };
  }, [rows]);

  return (
    <section style={dayCard}>
      <header style={dayHeader}>
        <h3 style={dayTitle}>{label}</h3>
        <div style={dayHeaderMeta}>
          <span style={dayCountPill}>
            {rows.length}{' '}
            {rows.length === 1
              ? t('admin.stockMovements.kpi.count').toLowerCase().replace(/s$/, '')
              : t('admin.stockMovements.kpi.count').toLowerCase()}
          </span>
          <span
            style={{
              ...dayNetCell,
              color: net.isZero()
                ? 'var(--text2)'
                : net.isNegative()
                  ? 'var(--red)'
                  : 'var(--green)',
            }}
          >
            {net.isZero() || net.isNegative() ? '' : '+'}
            {formatMoneyPlain(net.toString())}
          </span>
        </div>
      </header>

      <div style={tableWrap}>
        <div style={tableHead}>
          <span>{t('admin.stockMovements.col.time')}</span>
          <span>{t('admin.stockMovements.col.type')}</span>
          <span>{t('admin.stockMovements.col.supply')}</span>
          <span>{t('admin.stockMovements.col.storage')}</span>
          <span style={alignRight}>{t('admin.stockMovements.col.qty')}</span>
          <span style={alignRight}>
            {t('admin.stockMovements.col.unitCost')}
          </span>
          <span style={alignRight}>
            {t('admin.stockMovements.col.costImpact')}
          </span>
          <span>{t('admin.stockMovements.col.reference')}</span>
        </div>

        {rows.map((row) => (
          <MovementRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────

function MovementRow({ row }: { row: StockMovementRow }) {
  const { t } = useTranslation();
  const ts = TYPE_STYLES[row.type];
  const qtyDec = new Decimal(row.quantity);
  const impact = costImpactCents(row.quantity, row.unit_cost);
  const qtyPositive = qtyDec.isPositive() && !qtyDec.isZero();
  const qtyZero = qtyDec.isZero();

  // Quantities are signed at the DB layer (positive = in, negative = out).
  // We render the sign as a glyph so it lines up with the impact column.
  const qtyStr = fmtQty(row.quantity);
  const qtyColor = qtyZero
    ? 'var(--text2)'
    : qtyPositive
      ? 'var(--green)'
      : 'var(--red)';
  const qtySign = qtyZero ? '' : qtyPositive ? '+' : '−';
  const unsignedQty = qtyStr.replace(/^-/, '');

  return (
    <div style={tableRow}>
      <span style={cellTime}>{fmtTime(row.created_at)}</span>

      <span
        style={{
          ...typeBadgeStyle,
          background: ts.bg,
          color: ts.color,
          borderColor: ts.border,
          borderStyle: ts.borderStyle,
        }}
      >
        {t(`admin.stockMovements.type.${row.type}`)}
      </span>

      <span style={cellSupply}>
        <span style={supplyName}>{row.supply.name}</span>
        <span style={supplyUnit}>{row.supply.base_unit.toLowerCase()}</span>
      </span>

      <span style={cellStorage}>{row.storage.name}</span>

      <span style={{ ...cellNum, color: qtyColor, fontWeight: 600 }}>
        {qtySign}
        {unsignedQty}
      </span>

      <span style={cellNumMuted}>{formatMoneyPlain(row.unit_cost)}</span>

      <span
        style={{
          ...cellNum,
          color: qtyZero
            ? 'var(--text2)'
            : qtyPositive
              ? 'var(--green)'
              : 'var(--red)',
          fontWeight: 600,
        }}
      >
        {qtyZero ? '' : qtyPositive ? '+' : '−'}
        {formatMoneyPlain(impact.abs().toString())}
      </span>

      <span style={cellRef}>
        <span style={refType}>{row.reference_type}</span>
        <span style={refId} title={row.reference_id}>
          {t('admin.stockMovements.refShort')} {shortRefId(row.reference_id)}
        </span>
      </span>
    </div>
  );
}

// ─── Supply autocomplete ───────────────────────────────────────────────
// Lightweight inline picker. Renders the selected supply as a chip with
// an X to clear; when empty, exposes a debounced search-as-you-type input
// that hits the supplies search endpoint and drops the dropdown beneath.

interface SupplyAutocompleteProps {
  value: SupplySearchResult | null;
  onChange: (next: SupplySearchResult | null) => void;
  placeholder: string;
}

function SupplyAutocomplete({
  value,
  onChange,
  placeholder,
}: SupplyAutocompleteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 200ms debounce — long enough to avoid one request per keystroke,
  // short enough that picking the third hit doesn't feel laggy.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ['supplies-search', debounced],
    queryFn: () => searchSupplies(debounced, 10),
    enabled: debounced.length >= 1,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // Close on outside click — straight pointer-down listener so the
  // dropdown collapses the moment the user looks elsewhere.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (value) {
    return (
      <div style={chipWrap}>
        <span style={chipName}>{value.name}</span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery('');
          }}
          style={chipClear}
          aria-label={t('admin.stockMovements.supplyClear')}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={autocompleteWrap}>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        style={searchInput}
      />
      {open && debounced.length >= 1 && (
        <div style={dropdownStyle}>
          {searchQuery.isFetching && (searchQuery.data?.length ?? 0) === 0 ? (
            <div style={dropdownEmpty}>
              <Spinner size={12} />
              <span style={dropdownEmptyText}>
                {t('admin.stockMovements.searching')}…
              </span>
            </div>
          ) : (searchQuery.data?.length ?? 0) === 0 ? (
            <div style={dropdownEmpty}>
              <span style={dropdownEmptyText}>
                {t('common.noResults')}
              </span>
            </div>
          ) : (
            (searchQuery.data ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onChange(s);
                  setQuery('');
                  setOpen(false);
                }}
                style={dropdownRow}
              >
                <span style={dropdownRowName}>{s.name}</span>
                <span style={dropdownRowMeta}>
                  {s.base_unit.toLowerCase()}
                  {s.content_per_unit && s.content_unit
                    ? ` · ${s.content_per_unit} ${s.content_unit.toLowerCase()}`
                    : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────

function EmptyState({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={emptyShell}>
      <div style={emptyMark} aria-hidden="true" />
      <h3 style={emptyTitle}>{title}</h3>
      <p style={emptySub}>{sub}</p>
      {action}
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const filterBarStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '14px 16px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  marginBottom: 16,
  position: 'relative',
};

const filterGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const typeChipRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const typeChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '7px 12px',
  borderRadius: 999,
  border: '1px solid',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 32,
  transition: 'background 140ms ease-out, color 140ms ease-out',
};

const filterRowSecondary: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'flex-end',
};

const filterFieldGrow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: '1 1 180px',
  minWidth: 160,
};

const filterFieldGrowWide: CSSProperties = {
  ...filterFieldGrow,
  flex: '2 1 260px',
};

const filterFieldShrink: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: '0 0 auto',
};

const selectStyle: CSSProperties = {
  height: 36,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  minHeight: 36,
};

const rangePillRow: CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  flexWrap: 'wrap',
};

const customDateRow: CSSProperties = {
  display: 'flex',
  gap: 14,
  flexWrap: 'wrap',
};

const clearFiltersBtn: CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text2)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const kpiPlusGlyph: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 16,
  marginLeft: 4,
  color: 'var(--text3)',
  fontWeight: 500,
};

const loadingWrap: CSSProperties = {
  padding: '48px 0',
  display: 'flex',
  justifyContent: 'center',
};

const logStack: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const dayCard: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: 'var(--shadow-sm)',
};

const dayHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '14px 18px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg)',
  gap: 14,
};

const dayTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 17,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
  letterSpacing: '-0.005em',
};

const dayHeaderMeta: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const dayCountPill: CSSProperties = {
  fontSize: 11,
  padding: '3px 10px',
  borderRadius: 999,
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  fontWeight: 600,
  letterSpacing: '0.04em',
};

const dayNetCell: CSSProperties = {
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 700,
};

// Column grid — locked across the head and every row so values align
// vertically. Touch target on rows is enforced via padding (≥44px).
const COLUMN_GRID = '76px 110px minmax(0, 1.6fr) minmax(0, 1fr) 100px 100px 110px minmax(0, 1fr)';

const tableWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const tableHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLUMN_GRID,
  gap: 14,
  padding: '10px 18px',
  background: 'var(--bg2)',
  borderBottom: '1px solid var(--border)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
};

const tableRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLUMN_GRID,
  gap: 14,
  padding: '14px 18px',
  borderBottom: '1px solid rgba(226,220,212,0.6)',
  fontSize: 13,
  color: 'var(--text1)',
  alignItems: 'center',
  fontVariantNumeric: 'tabular-nums',
  minHeight: 44,
};

const cellTime: CSSProperties = {
  color: 'var(--text2)',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
};

const typeBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '3px 8px',
  borderRadius: 6,
  border: '1px solid',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const cellSupply: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minWidth: 0,
};

const supplyName: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text1)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const supplyUnit: CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 600,
};

const cellStorage: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const alignRight: CSSProperties = {
  textAlign: 'right',
};

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 12.5,
};

const cellNumMuted: CSSProperties = {
  ...cellNum,
  color: 'var(--text3)',
};

const cellRef: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minWidth: 0,
};

const refType: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text2)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const refId: CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  letterSpacing: '0.04em',
};

const footerWrap: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '8px 0 24px',
};

const loadMoreBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 20px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  minHeight: 44,
  letterSpacing: '0.02em',
};

const endOfLog: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 600,
};

const emptyShell: CSSProperties = {
  padding: '60px 24px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: 8,
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
};

const emptyMark: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 12,
  border: '2px dashed rgba(168,152,136,0.45)',
  marginBottom: 6,
};

const emptyTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const emptySub: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  maxWidth: '38ch',
  lineHeight: 1.45,
  margin: '4px 0 12px',
};

const emptyClearBtn: CSSProperties = {
  padding: '9px 16px',
  borderRadius: 8,
  background: 'var(--text1)',
  color: '#fff',
  border: '1px solid var(--text1)',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  letterSpacing: '0.04em',
  minHeight: 40,
};

// Supply autocomplete styles ──────────────────────────────────────────

const autocompleteWrap: CSSProperties = {
  position: 'relative',
};

const searchInput: CSSProperties = {
  height: 36,
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const chipWrap: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 8px 0 12px',
  border: '1px solid var(--text1)',
  borderRadius: 8,
  background: 'var(--bg)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  maxWidth: '100%',
};

const chipName: CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const chipClear: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  background: 'transparent',
  border: 'none',
  color: 'var(--text2)',
  fontSize: 18,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
};

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  boxShadow: 'var(--shadow-lg)',
  zIndex: 20,
  maxHeight: 280,
  overflowY: 'auto',
  padding: '4px 0',
};

const dropdownRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  padding: '8px 12px',
  background: 'transparent',
  border: 'none',
  width: '100%',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  minHeight: 44,
  justifyContent: 'center',
};

const dropdownRowName: CSSProperties = {
  fontSize: 13,
  color: 'var(--text1)',
  fontWeight: 500,
};

const dropdownRowMeta: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  letterSpacing: '0.04em',
};

const dropdownEmpty: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 14px',
};

const dropdownEmptyText: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
};
