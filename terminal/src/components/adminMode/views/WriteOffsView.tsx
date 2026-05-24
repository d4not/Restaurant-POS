// Inventory · Write-offs (mermas) — full-screen admin workspace.
//
// What sets this apart from the cashier-side WasteModal (which is a single-row
// modal) is the combination of three views on one canvas:
//
//   1. KPI strip — at-a-glance cost lost in the selected period, the
//      most-affected supply, and the top reason. Numbers are the hero
//      (PRODUCT.md principle #2).
//   2. Filters — period / storage / reason / supply, all backed by the
//      backend's listWriteOffQuerySchema. Period swaps from / to ISO dates
//      and resets the cursor.
//   3. Composer + History — collapsed by default. Operators expand it,
//      pick a storage once, then queue multiple rows (one per loss they
//      spotted on the walk-through). Submit fires Promise.allSettled so a
//      single bad row doesn't lose the others.
//
// Cost impact is computed on the client by joining each write-off's
// quantity against the supply's average_cost. The /supplies listing
// already returns average_cost on the wire — we just need to widen the
// local type to read it.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { api, ApiError } from '../../../api/client';
import { listStorages, type Storage } from '../../../api/storages';
import { type SupplySummary } from '../../../api/supplies';
import type { PageResult } from '../../../api/pagination';
import {
  createWriteOff,
  WRITE_OFF_REASONS,
  type CreateWriteOffInput,
  type WriteOff,
  type WriteOffReason,
} from '../../../api/write-offs';
import { useTranslation } from '../../../i18n';
import type { TranslationKey } from '../../../i18n/en';
import { adminStyles } from '../styles';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import { formatMoneyPlain } from '../../../utils/format';
import { IconTrash } from '../../operations-hub/HubIcons';

interface WriteOffsViewProps {
  onBack: () => void;
}

// The /supplies listing endpoint returns the full Supply row but our shared
// SupplySummary type omits average_cost. We re-fetch through the api client
// directly with a wider local type so cost impact calculations have what
// they need.
interface SupplyWithCost extends SupplySummary {
  average_cost: string;
  category_id: string | null;
}

async function fetchSuppliesWithCost(): Promise<SupplyWithCost[]> {
  const out: SupplyWithCost[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<SupplyWithCost>>(
      `/supplies?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

// Slim stock query so the composer can show "On hand: X" beside each row.
// We only ever ask for the active storage the operator just picked.
async function fetchStorageStockMap(
  storageId: string,
): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>();
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<
      PageResult<{ supply_id: string; quantity: string }>
    >(`/storages/${storageId}/stocks?${sp.toString()}`);
    for (const row of page.items) {
      out.set(row.supply_id, new Decimal(row.quantity));
    }
    cursor = page.nextCursor;
    if (out.size >= 5000) break;
  } while (cursor);
  return out;
}

// ─── Period presets ────────────────────────────────────────────────────
type Period = '7' | '30' | '90' | 'all';

function periodToRange(period: Period): { from?: string; to?: string } {
  if (period === 'all') return {};
  const days = Number(period);
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ─── Reason styling ────────────────────────────────────────────────────
//
// Per PRODUCT.md principle #3 — let semantic color do the work. EXPIRED and
// THEFT are the operator-actionable losses (taught us to rotate stock; flag
// it for the manager) so they get the red badge. DAMAGED / SPILLED ride
// gold (gentler "watch this"), OTHER stays neutral.
function reasonStyle(r: WriteOffReason): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    border: '1px solid',
    whiteSpace: 'nowrap',
  };
  switch (r) {
    case 'EXPIRED':
    case 'THEFT':
      return {
        ...base,
        background: 'rgba(196,80,64,0.10)',
        color: 'var(--red)',
        borderColor: 'rgba(196,80,64,0.32)',
      };
    case 'DAMAGED':
    case 'SPILLED':
      return {
        ...base,
        background: 'rgba(201,164,92,0.14)',
        color: '#8a6d2a',
        borderColor: 'rgba(201,164,92,0.40)',
      };
    case 'OTHER':
    default:
      return {
        ...base,
        background: 'rgba(168,152,136,0.16)',
        color: 'var(--text2)',
        borderColor: 'var(--border)',
      };
  }
}

function fmtQty(qty: string | number, unit: string): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return `— ${unit}`;
  // 4 decimals max, strip trailing zeros — quantities like "0.5" should not
  // render as "0.5000" and 1.2345 should keep their precision.
  const s = n.toFixed(4).replace(/\.?0+$/, '');
  return `${s} ${unit}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ─── Composer row model ────────────────────────────────────────────────
interface DraftRow {
  key: string;
  supplyId: string;
  supplyName: string;
  unit: string;
  averageCost: string;
  quantity: string;
  reason: WriteOffReason;
  notes: string;
  error: string | null;
}

const COMPOSER_COLS = 'minmax(0, 1.6fr) 110px 64px minmax(180px, 1.4fr) minmax(0, 1.8fr) 38px';
const HISTORY_COLS = '128px 1fr 1.5fr 110px 110px 100px 110px';

export function WriteOffsView({ onBack }: WriteOffsViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ─── Filter state
  const [period, setPeriod] = useState<Period>('30');
  const [storageFilter, setStorageFilter] = useState<string>('');
  const [reasonFilter, setReasonFilter] = useState<WriteOffReason | ''>('');
  const [supplyFilter, setSupplyFilter] = useState<string>('');

  // ─── Composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStorageId, setComposerStorageId] = useState<string>('');
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [supplyQuery, setSupplyQuery] = useState('');
  const [composerBanner, setComposerBanner] = useState<
    { tone: 'ok' | 'partial' | 'err'; text: string } | null
  >(null);

  // ─── Data sources
  const storagesQuery = useQuery({
    queryKey: ['storages', { active: true }],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });
  const storages = storagesQuery.data ?? [];

  const suppliesQuery = useQuery({
    queryKey: ['admin-supplies-with-cost'],
    queryFn: fetchSuppliesWithCost,
    staleTime: 60_000,
  });
  const supplies = suppliesQuery.data ?? [];

  const supplyMap = useMemo(() => {
    const m = new Map<string, SupplyWithCost>();
    for (const s of supplies) m.set(s.id, s);
    return m;
  }, [supplies]);

  // Cache stocks for any storage we paginate through (composer can switch).
  const composerStockQuery = useQuery({
    queryKey: ['admin-stocks', composerStorageId],
    queryFn: () => fetchStorageStockMap(composerStorageId),
    enabled: Boolean(composerStorageId),
    staleTime: 30_000,
  });
  const composerStock = composerStockQuery.data ?? new Map<string, Decimal>();

  const periodRange = useMemo(() => periodToRange(period), [period]);

  // Cursor pages — we manage the cursor by hand instead of using
  // useInfiniteQuery so the list is easy to invalidate on submit.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  // Reset cursors whenever filters change — a stale cursor against a new
  // filter combo would return wrong rows.
  useEffect(() => {
    setCursors([null]);
  }, [period, storageFilter, reasonFilter, supplyFilter]);

  const listQueries = useQueries({
    queries: cursors.map((cursor) => ({
      queryKey: [
        'writeOffs',
        {
          cursor,
          period,
          storage: storageFilter,
          reason: reasonFilter,
          supply: supplyFilter,
        },
      ] as const,
      queryFn: async () => {
        const sp = new URLSearchParams();
        sp.set('limit', '25');
        if (cursor) sp.set('cursor', cursor);
        if (periodRange.from) sp.set('from', periodRange.from);
        if (periodRange.to) sp.set('to', periodRange.to);
        if (storageFilter) sp.set('storage_id', storageFilter);
        if (reasonFilter) sp.set('reason', reasonFilter);
        if (supplyFilter) sp.set('supply_id', supplyFilter);
        return api.get<PageResult<WriteOff>>(`/write-offs?${sp.toString()}`);
      },
      staleTime: 30_000,
    })),
  });

  const pages = listQueries
    .map((q) => q.data)
    .filter((p): p is PageResult<WriteOff> => Boolean(p));
  const rows: WriteOff[] = useMemo(
    () => pages.flatMap((p) => p.items),
    [pages],
  );
  const nextCursor = pages.length > 0 ? pages[pages.length - 1].nextCursor : null;
  const listLoading = listQueries.some((q) => q.isLoading);
  const loadingMore = listQueries[listQueries.length - 1]?.isFetching ?? false;

  // ─── KPIs (computed across the rows currently loaded — period filter is
  // already applied server-side, so this is "lost in the period"). When the
  // operator loads more pages, the KPIs grow accordingly.
  const kpis = useMemo(() => {
    let totalLoss = new Decimal(0);
    const byReason: Record<WriteOffReason, number> = {
      EXPIRED: 0,
      DAMAGED: 0,
      SPILLED: 0,
      THEFT: 0,
      OTHER: 0,
    };
    const bySupplyLoss = new Map<string, Decimal>();
    const supplyNames = new Map<string, string>();
    for (const row of rows) {
      const sup = supplyMap.get(row.supply_id);
      const avg = sup ? new Decimal(sup.average_cost) : new Decimal(0);
      const qty = new Decimal(row.quantity);
      const loss = avg.times(qty);
      totalLoss = totalLoss.plus(loss);
      byReason[row.reason] += 1;
      supplyNames.set(row.supply_id, row.supply.name);
      const existing = bySupplyLoss.get(row.supply_id) ?? new Decimal(0);
      bySupplyLoss.set(row.supply_id, existing.plus(loss));
    }
    // Top reason by count; top supply by lost value.
    let topReason: WriteOffReason | null = null;
    let topReasonCount = 0;
    for (const r of WRITE_OFF_REASONS) {
      if (byReason[r] > topReasonCount) {
        topReason = r;
        topReasonCount = byReason[r];
      }
    }
    let topSupplyId: string | null = null;
    let topSupplyLoss = new Decimal(0);
    for (const [id, loss] of bySupplyLoss) {
      if (loss.gt(topSupplyLoss)) {
        topSupplyId = id;
        topSupplyLoss = loss;
      }
    }
    return {
      totalLoss,
      count: rows.length,
      topReason,
      topReasonCount,
      topSupplyName: topSupplyId ? (supplyNames.get(topSupplyId) ?? null) : null,
      topSupplyLoss,
    };
  }, [rows, supplyMap]);

  // ─── Composer ops
  function openComposer(): void {
    setComposerBanner(null);
    setComposerOpen(true);
    if (!composerStorageId && storages.length === 1) {
      setComposerStorageId(storages[0].id);
    }
  }

  function closeComposer(): void {
    setComposerOpen(false);
  }

  function clearComposer(): void {
    setDrafts([]);
    setSupplyQuery('');
    setComposerBanner(null);
  }

  function addDraftFromSupply(supply: SupplyWithCost): void {
    setDrafts((prev) => {
      if (prev.some((d) => d.supplyId === supply.id)) return prev;
      return [
        ...prev,
        {
          key: `${supply.id}-${Date.now()}`,
          supplyId: supply.id,
          supplyName: supply.name,
          unit: supply.base_unit,
          averageCost: supply.average_cost,
          quantity: '',
          reason: 'EXPIRED',
          notes: '',
          error: null,
        },
      ];
    });
    setSupplyQuery('');
  }

  function updateDraft(key: string, patch: Partial<DraftRow>): void {
    setDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    );
  }

  function removeDraft(key: string): void {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  // Submit: one POST per row via Promise.allSettled. Rows that succeed are
  // pruned; rows that fail keep their input and surface their error inline.
  const submitMutation = useMutation({
    mutationFn: async (input: {
      storageId: string;
      rows: DraftRow[];
    }): Promise<{
      okKeys: string[];
      errors: { key: string; message: string }[];
    }> => {
      const settled = await Promise.allSettled(
        input.rows.map((d) => {
          const payload: CreateWriteOffInput = {
            storage_id: input.storageId,
            supply_id: d.supplyId,
            quantity: Number(d.quantity),
            reason: d.reason,
            notes: d.notes.trim() || undefined,
            date: new Date().toISOString(),
          };
          return createWriteOff(payload);
        }),
      );
      const okKeys: string[] = [];
      const errors: { key: string; message: string }[] = [];
      settled.forEach((res, idx) => {
        const key = input.rows[idx].key;
        if (res.status === 'fulfilled') {
          okKeys.push(key);
        } else {
          const err = res.reason;
          let message = t('admin.writeOffs.error.quantity');
          if (err instanceof ApiError) {
            message =
              err.code === 'CONFLICT'
                ? t('admin.writeOffs.error.insufficient')
                : err.message;
          }
          errors.push({ key, message });
        }
      });
      return { okKeys, errors };
    },
    onSuccess: async (result, variables) => {
      const failedKeys = new Set(result.errors.map((e) => e.key));
      setDrafts((prev) =>
        prev
          .filter((d) => failedKeys.has(d.key))
          .map((d) => ({
            ...d,
            error: result.errors.find((e) => e.key === d.key)?.message ?? null,
          })),
      );
      const total = variables.rows.length;
      const ok = result.okKeys.length;
      if (ok === total) {
        setComposerBanner({
          tone: 'ok',
          text: t('admin.writeOffs.successAll').replace('{n}', String(ok)),
        });
      } else if (ok > 0) {
        setComposerBanner({
          tone: 'partial',
          text: `${t('admin.writeOffs.success')
            .replace('{n}', String(ok))
            .replace('{total}', String(total))} ${t(
            'admin.writeOffs.partial',
          ).replace('{n}', String(total - ok))}`,
        });
      } else {
        setComposerBanner({
          tone: 'err',
          text: t('admin.writeOffs.partial').replace(
            '{n}',
            String(total - ok),
          ),
        });
      }
      if (ok > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['writeOffs'] }),
          queryClient.invalidateQueries({ queryKey: ['admin-stocks'] }),
          queryClient.invalidateQueries({ queryKey: ['supplies'] }),
        ]);
        setCursors([null]);
      }
    },
  });

  function submitDrafts(): void {
    if (!composerStorageId) {
      setComposerBanner({
        tone: 'err',
        text: t('admin.writeOffs.error.noStorage'),
      });
      return;
    }
    if (drafts.length === 0) {
      setComposerBanner({
        tone: 'err',
        text: t('admin.writeOffs.error.noLines'),
      });
      return;
    }
    // Per-row validation before any network call. A row that fails this
    // gate gets a sticky inline error and the whole submit aborts so the
    // operator can see every problem at once.
    let blocked = false;
    setDrafts((prev) =>
      prev.map((d) => {
        const qty = Number(d.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          blocked = true;
          return { ...d, error: t('admin.writeOffs.error.quantity') };
        }
        return { ...d, error: null };
      }),
    );
    if (blocked) {
      setComposerBanner({
        tone: 'err',
        text: t('admin.writeOffs.error.quantity'),
      });
      return;
    }
    setComposerBanner(null);
    // Pull a stable snapshot — drafts state is about to flip beneath us
    // in onSuccess.
    submitMutation.mutate({
      storageId: composerStorageId,
      rows: drafts.map((d) => ({ ...d, error: null })),
    });
  }

  // ─── Supply autocomplete (composer)
  const supplySuggestions = useMemo(() => {
    const q = supplyQuery.trim().toLowerCase();
    if (!q) return [];
    const inDrafts = new Set(drafts.map((d) => d.supplyId));
    const hits: SupplyWithCost[] = [];
    for (const s of supplies) {
      if (inDrafts.has(s.id)) continue;
      const hay = `${s.name} ${s.barcode ?? ''}`.toLowerCase();
      if (hay.includes(q)) hits.push(s);
      if (hits.length >= 8) break;
    }
    return hits;
  }, [supplies, supplyQuery, drafts]);

  // ─── Composer totals
  const composerTotals = useMemo(() => {
    let cost = new Decimal(0);
    let units = new Decimal(0);
    for (const d of drafts) {
      const qty = new Decimal(d.quantity || 0);
      const avg = new Decimal(d.averageCost || 0);
      cost = cost.plus(qty.times(avg));
      units = units.plus(qty);
    }
    return { cost, units };
  }, [drafts]);

  // ─── Render helpers
  const submitLabel =
    drafts.length === 1
      ? t('admin.writeOffs.composeSubmitOne')
      : t('admin.writeOffs.composeSubmit').replace(
          '{n}',
          String(drafts.length),
        );

  function reasonLabel(r: WriteOffReason): string {
    return t(`admin.writeOffs.reason.${r}` as TranslationKey);
  }

  return (
    <AdminViewShell
      titleKey="admin.writeOffs.title"
      subtitleKey="admin.writeOffs.subtitle"
      onBack={onBack}
      headerActions={
        <button
          type="button"
          style={composerOpen ? localStyles.ctaGhost : localStyles.ctaPrimary}
          onClick={composerOpen ? closeComposer : openComposer}
        >
          {composerOpen
            ? t('admin.writeOffs.composeCollapse')
            : t('admin.writeOffs.composeCta')}
        </button>
      }
    >
      {/* ─── KPI strip ────────────────────────────────────────────────── */}
      <div style={adminStyles.kpiRow}>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>
            {t('admin.writeOffs.kpi.lostValue')}
          </span>
          <span
            style={{
              ...adminStyles.kpiValue,
              color: kpis.totalLoss.isZero() ? 'var(--text1)' : 'var(--red)',
            }}
          >
            {formatMoneyPlain(kpis.totalLoss.toFixed(0))}
          </span>
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>
            {t('admin.writeOffs.kpi.count')}
          </span>
          <span style={adminStyles.kpiValue}>{kpis.count}</span>
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>
            {t('admin.writeOffs.kpi.topReason')}
          </span>
          {kpis.topReason ? (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <span style={reasonStyle(kpis.topReason)}>
                {reasonLabel(kpis.topReason)}
              </span>
              <span style={localStyles.kpiAside}>×{kpis.topReasonCount}</span>
            </span>
          ) : (
            <span style={localStyles.kpiMuted}>
              {t('admin.writeOffs.kpi.none')}
            </span>
          )}
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>
            {t('admin.writeOffs.kpi.topSupply')}
          </span>
          {kpis.topSupplyName ? (
            <span style={localStyles.kpiSupply}>
              <span style={localStyles.kpiSupplyName}>
                {kpis.topSupplyName}
              </span>
              <span style={localStyles.kpiAside}>
                {formatMoneyPlain(kpis.topSupplyLoss.toFixed(0))}
              </span>
            </span>
          ) : (
            <span style={localStyles.kpiMuted}>
              {t('admin.writeOffs.kpi.none')}
            </span>
          )}
        </div>
      </div>

      {/* ─── Composer ───────────────────────────────────────────────── */}
      {composerOpen && (
        <section style={localStyles.composer}>
          <div style={localStyles.composerHead}>
            <div style={{ minWidth: 0 }}>
              <h3 style={localStyles.composerTitle}>
                {t('admin.writeOffs.composeTitle')}
              </h3>
              <p style={localStyles.composerSub}>
                {t('admin.writeOffs.composeSub')}
              </p>
            </div>
            {drafts.length > 0 && (
              <button
                type="button"
                style={localStyles.clearBtn}
                onClick={clearComposer}
                disabled={submitMutation.isPending}
              >
                {t('admin.writeOffs.composeClear')}
              </button>
            )}
          </div>

          {/* Storage picker — one tap chooses for every row. */}
          <div style={localStyles.composerStorageBlock}>
            <span style={adminStyles.filterLabel}>
              {t('admin.writeOffs.composeStorage')}
            </span>
            <div style={localStyles.storagePillRow}>
              {storages.length === 0 ? (
                <span style={localStyles.kpiMuted}>—</span>
              ) : (
                storages.map((s: Storage) => {
                  const active = s.id === composerStorageId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setComposerStorageId(s.id)}
                      style={{
                        ...localStyles.storagePill,
                        ...(active ? localStyles.storagePillActive : null),
                      }}
                    >
                      {s.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Draft rows */}
          {!composerStorageId ? (
            <div style={localStyles.composerHint}>
              {t('admin.writeOffs.composeStorageHint')}
            </div>
          ) : (
            <>
              {drafts.length > 0 && (
                <div style={localStyles.draftTable}>
                  <div
                    style={{
                      ...localStyles.draftHead,
                      gridTemplateColumns: COMPOSER_COLS,
                    }}
                  >
                    <span>{t('admin.writeOffs.col.supply')}</span>
                    <span style={alignRight}>
                      {t('admin.writeOffs.composeQty')}
                    </span>
                    <span style={localStyles.unitHead}>
                      {t('admin.writeOffs.col.qty')}
                    </span>
                    <span>{t('admin.writeOffs.composeReason')}</span>
                    <span>{t('admin.writeOffs.composeNotes')}</span>
                    <span />
                  </div>
                  {drafts.map((d) => {
                    const onHand = composerStock.get(d.supplyId);
                    const qtyNum = new Decimal(d.quantity || 0);
                    const over = onHand ? qtyNum.gt(onHand) : false;
                    const rowLoss = qtyNum.times(
                      new Decimal(d.averageCost || 0),
                    );
                    return (
                      <div
                        key={d.key}
                        style={{
                          ...localStyles.draftRow,
                          gridTemplateColumns: COMPOSER_COLS,
                        }}
                      >
                        <div style={localStyles.draftSupplyCell}>
                          <span style={localStyles.draftSupplyName}>
                            {d.supplyName}
                          </span>
                          {onHand && (
                            <span style={localStyles.draftStockHint}>
                              {t('admin.writeOffs.composeStockHint')
                                .replace('{qty}', fmtQty(onHand.toString(), d.unit))
                                .replace(' {unit}', '')}
                            </span>
                          )}
                          {rowLoss.gt(0) && (
                            <span style={localStyles.draftLoss}>
                              −{formatMoneyPlain(rowLoss.toFixed(0))}
                            </span>
                          )}
                        </div>
                        <div style={alignRight}>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step={0.0001}
                            value={d.quantity}
                            onChange={(e) =>
                              updateDraft(d.key, {
                                quantity: e.target.value,
                                error: null,
                              })
                            }
                            placeholder="0"
                            style={{
                              ...localStyles.qtyInput,
                              borderColor: over
                                ? 'rgba(196,80,64,0.55)'
                                : 'var(--border)',
                              color: over ? 'var(--red)' : 'var(--text1)',
                            }}
                          />
                        </div>
                        <div style={localStyles.unitCell}>{d.unit}</div>
                        <div style={localStyles.reasonPicker}>
                          {WRITE_OFF_REASONS.map((r) => {
                            const active = d.reason === r;
                            return (
                              <button
                                key={r}
                                type="button"
                                onClick={() => updateDraft(d.key, { reason: r })}
                                style={{
                                  ...localStyles.reasonChip,
                                  ...(active
                                    ? reasonStyle(r)
                                    : localStyles.reasonChipInactive),
                                }}
                                title={reasonLabel(r)}
                              >
                                {reasonLabel(r)}
                              </button>
                            );
                          })}
                        </div>
                        <input
                          type="text"
                          value={d.notes}
                          onChange={(e) =>
                            updateDraft(d.key, { notes: e.target.value })
                          }
                          maxLength={2000}
                          placeholder={t(
                            'admin.writeOffs.composeNotesPlaceholder',
                          )}
                          style={localStyles.notesInput}
                        />
                        <button
                          type="button"
                          onClick={() => removeDraft(d.key)}
                          style={localStyles.draftRemoveBtn}
                          aria-label={t('admin.writeOffs.composeRemove')}
                        >
                          <IconTrash style={{ fontSize: 14 }} />
                        </button>

                        {(d.error || over) && (
                          <div style={localStyles.draftRowError}>
                            {d.error ??
                              t('admin.writeOffs.composeOverstock')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Supply picker — typeahead, no separate "add item" button.
                  Searching and picking from the dropdown IS the add action. */}
              <div style={localStyles.pickerWrap}>
                <label style={adminStyles.filterLabel}>
                  {t('admin.writeOffs.composeAddLine')}
                </label>
                <div style={localStyles.pickerInputRow}>
                  <input
                    type="text"
                    value={supplyQuery}
                    onChange={(e) => setSupplyQuery(e.target.value)}
                    placeholder={t('admin.writeOffs.composeScanHint')}
                    style={localStyles.pickerInput}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Enter' &&
                        supplySuggestions.length > 0
                      ) {
                        e.preventDefault();
                        addDraftFromSupply(supplySuggestions[0]);
                      }
                    }}
                  />
                </div>
                {supplyQuery.trim() && (
                  <div style={localStyles.suggestList}>
                    {supplySuggestions.length === 0 ? (
                      <div style={localStyles.suggestEmpty}>
                        {t('admin.writeOffs.composeEmptyLines')}
                      </div>
                    ) : (
                      supplySuggestions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          style={localStyles.suggestRow}
                          onClick={() => addDraftFromSupply(s)}
                        >
                          <span style={localStyles.suggestName}>{s.name}</span>
                          <span style={localStyles.suggestUnit}>
                            {s.base_unit}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {drafts.length === 0 && !supplyQuery.trim() && (
                <div style={localStyles.composerHint}>
                  {t('admin.writeOffs.composeEmptyLines')}
                </div>
              )}
            </>
          )}

          {/* Banner + totals + submit. The bottom band stays put so the
              operator's eye lands on it after they've finished a list. */}
          {composerBanner && (
            <div
              style={{
                ...localStyles.banner,
                ...(composerBanner.tone === 'ok'
                  ? localStyles.bannerOk
                  : composerBanner.tone === 'partial'
                    ? localStyles.bannerWarn
                    : localStyles.bannerErr),
              }}
            >
              {composerBanner.text}
            </div>
          )}

          <div style={localStyles.composerFoot}>
            <div style={localStyles.composerTotals}>
              <span style={localStyles.totalCell}>
                <span style={localStyles.totalLabel}>
                  {t('admin.writeOffs.totals.lines')}
                </span>
                <span style={localStyles.totalValue}>{drafts.length}</span>
              </span>
              <span style={localStyles.totalCell}>
                <span style={localStyles.totalLabel}>
                  {t('admin.writeOffs.totals.units')}
                </span>
                <span style={localStyles.totalValue}>
                  {composerTotals.units.toString()}
                </span>
              </span>
              <span style={localStyles.totalCell}>
                <span style={localStyles.totalLabel}>
                  {t('admin.writeOffs.totals.cost')}
                </span>
                <span
                  style={{
                    ...localStyles.totalValue,
                    color: composerTotals.cost.isZero()
                      ? 'var(--text1)'
                      : 'var(--red)',
                  }}
                >
                  −{formatMoneyPlain(composerTotals.cost.toFixed(0))}
                </span>
              </span>
            </div>
            <button
              type="button"
              style={{
                ...localStyles.submitBtn,
                opacity: submitMutation.isPending || drafts.length === 0 ? 0.6 : 1,
                cursor:
                  submitMutation.isPending || drafts.length === 0
                    ? 'not-allowed'
                    : 'pointer',
              }}
              disabled={submitMutation.isPending || drafts.length === 0}
              onClick={submitDrafts}
            >
              {submitMutation.isPending && <Spinner size={14} />}
              {submitMutation.isPending
                ? t('admin.writeOffs.composeSubmitting')
                : submitLabel}
            </button>
          </div>
        </section>
      )}

      {/* ─── Filters ──────────────────────────────────────────────────── */}
      <div style={localStyles.filtersBar}>
        <div style={localStyles.filterGroup}>
          <span style={adminStyles.filterLabel}>
            {t('admin.writeOffs.filter.period')}
          </span>
          <div style={adminStyles.pillRow}>
            {(
              [
                ['7', 'admin.writeOffs.filter.period.7'],
                ['30', 'admin.writeOffs.filter.period.30'],
                ['90', 'admin.writeOffs.filter.period.90'],
                ['all', 'admin.writeOffs.filter.period.all'],
              ] as const
            ).map(([key, labelKey]) => (
              <button
                key={key}
                type="button"
                style={{
                  ...adminStyles.pillBtn,
                  ...(period === key ? adminStyles.pillBtnActive : null),
                }}
                onClick={() => setPeriod(key)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div style={localStyles.filterGroup}>
          <label style={adminStyles.filterLabel}>
            {t('admin.writeOffs.filter.storage')}
          </label>
          <select
            value={storageFilter}
            onChange={(e) => setStorageFilter(e.target.value)}
            style={localStyles.select}
          >
            <option value="">{t('admin.writeOffs.filter.storageAll')}</option>
            {storages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div style={localStyles.filterGroup}>
          <label style={adminStyles.filterLabel}>
            {t('admin.writeOffs.filter.reason')}
          </label>
          <div style={adminStyles.pillRow}>
            <button
              type="button"
              style={{
                ...adminStyles.pillBtn,
                ...(reasonFilter === '' ? adminStyles.pillBtnActive : null),
              }}
              onClick={() => setReasonFilter('')}
            >
              {t('admin.writeOffs.filter.reasonAll')}
            </button>
            {WRITE_OFF_REASONS.map((r) => {
              const active = reasonFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  style={{
                    ...adminStyles.pillBtn,
                    ...(active ? adminStyles.pillBtnActive : null),
                  }}
                  onClick={() => setReasonFilter(r)}
                >
                  {reasonLabel(r)}
                </button>
              );
            })}
          </div>
        </div>

        <div style={localStyles.filterGroup}>
          <label style={adminStyles.filterLabel}>
            {t('admin.writeOffs.filter.supply')}
          </label>
          <select
            value={supplyFilter}
            onChange={(e) => setSupplyFilter(e.target.value)}
            style={localStyles.select}
          >
            <option value="">{t('admin.writeOffs.filter.supplyAll')}</option>
            {supplies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── History ─────────────────────────────────────────────────── */}
      <section style={{ marginTop: 6 }}>
        <h3 style={localStyles.sectionTitle}>
          {t('admin.writeOffs.history.title')}
        </h3>

        {listLoading && rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <div style={localStyles.empty}>
            {t('admin.writeOffs.history.empty')}
          </div>
        ) : (
          <div style={localStyles.historyTable}>
            <div
              style={{
                ...localStyles.historyHead,
                gridTemplateColumns: HISTORY_COLS,
              }}
            >
              <span>{t('admin.writeOffs.col.date')}</span>
              <span>{t('admin.writeOffs.col.storage')}</span>
              <span>{t('admin.writeOffs.col.supply')}</span>
              <span style={alignRight}>{t('admin.writeOffs.col.qty')}</span>
              <span>{t('admin.writeOffs.col.reason')}</span>
              <span style={alignRight}>{t('admin.writeOffs.col.cost')}</span>
              <span>{t('admin.writeOffs.col.user')}</span>
            </div>
            {rows.map((row) => {
              const sup = supplyMap.get(row.supply_id);
              const cost = sup
                ? new Decimal(sup.average_cost).times(
                    new Decimal(row.quantity),
                  )
                : new Decimal(0);
              return (
                <div
                  key={row.id}
                  style={{
                    ...localStyles.historyRow,
                    gridTemplateColumns: HISTORY_COLS,
                  }}
                >
                  <span style={localStyles.cellMuted}>
                    {fmtDateTime(row.date)}
                  </span>
                  <span style={localStyles.cellMuted}>
                    {row.storage.name}
                  </span>
                  <div style={localStyles.supplyCell}>
                    <span style={localStyles.supplyName}>
                      {row.supply.name}
                    </span>
                    {row.notes && (
                      <span style={localStyles.notesLine}>{row.notes}</span>
                    )}
                  </div>
                  <span style={localStyles.qtyCell}>
                    {fmtQty(row.quantity, row.supply.base_unit)}
                  </span>
                  <span>
                    <span style={reasonStyle(row.reason)}>
                      {reasonLabel(row.reason)}
                    </span>
                  </span>
                  <span style={localStyles.costCell}>
                    {cost.isZero()
                      ? t('admin.writeOffs.kpi.none')
                      : `−${formatMoneyPlain(cost.toFixed(0))}`}
                  </span>
                  <span style={localStyles.cellMuted}>
                    {row.user?.name ?? '—'}
                  </span>
                </div>
              );
            })}

            {nextCursor && (
              <div style={localStyles.loadMoreRow}>
                <button
                  type="button"
                  style={localStyles.loadMoreBtn}
                  onClick={() => setCursors((c) => [...c, nextCursor])}
                  disabled={loadingMore}
                >
                  {loadingMore && <Spinner size={12} />}
                  {loadingMore
                    ? t('admin.writeOffs.history.loading')
                    : t('admin.writeOffs.history.loadMore')}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </AdminViewShell>
  );
}

// ─── Local styles ──────────────────────────────────────────────────────

const alignRight: CSSProperties = { textAlign: 'right' };

const localStyles: Record<string, CSSProperties> = {
  ctaPrimary: {
    border: '1px solid var(--text1)',
    background: 'var(--text1)',
    color: '#fff',
    padding: '9px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 38,
  },
  ctaGhost: {
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '9px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 38,
  },
  kpiAside: {
    fontSize: 12,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
  },
  kpiMuted: {
    fontSize: 14,
    color: 'var(--text3)',
    fontWeight: 500,
  },
  kpiSupply: {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  kpiSupplyName: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    lineHeight: 1.15,
  },

  // ─── Composer
  composer: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '20px 22px 18px',
    marginBottom: 22,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    boxShadow: 'var(--shadow-sm)',
  },
  composerHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  composerTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  composerSub: {
    fontSize: 12,
    color: 'var(--text2)',
    margin: '4px 0 0',
  },
  clearBtn: {
    border: '1px solid rgba(196,80,64,0.30)',
    background: 'transparent',
    color: 'var(--red)',
    padding: '7px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  composerStorageBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  storagePillRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  storagePill: {
    padding: '8px 16px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  storagePillActive: {
    background: 'var(--text1)',
    color: '#fff',
    borderColor: 'var(--text1)',
  },
  composerHint: {
    padding: '14px 16px',
    border: '1px dashed var(--border)',
    borderRadius: 10,
    color: 'var(--text3)',
    fontSize: 13,
    background: 'rgba(196,80,64,0.025)',
  },

  // Draft table — hairline divided, not a card-within-a-card.
  draftTable: {
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
    background: 'rgba(196,80,64,0.025)',
  },
  draftHead: {
    display: 'grid',
    gap: 12,
    padding: '10px 14px',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
    alignItems: 'center',
  },
  draftRow: {
    display: 'grid',
    gap: 12,
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    fontSize: 13,
    rowGap: 6,
  },
  draftSupplyCell: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    gap: 2,
  },
  draftSupplyName: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text1)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  draftStockHint: {
    fontSize: 11,
    color: 'var(--text3)',
    fontVariantNumeric: 'tabular-nums',
  },
  draftLoss: {
    fontSize: 11,
    color: 'var(--red)',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  },
  qtyInput: {
    width: '100%',
    height: 36,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '0 10px',
    fontFamily: 'inherit',
    fontSize: 14,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  unitHead: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
    textAlign: 'center',
  },
  unitCell: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text3)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  reasonPicker: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  reasonChip: {
    padding: '3px 9px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    border: '1px solid',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  reasonChipInactive: {
    background: 'transparent',
    color: 'var(--text3)',
    borderColor: 'var(--border)',
  },
  notesInput: {
    width: '100%',
    height: 36,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '0 10px',
    fontFamily: 'inherit',
    fontSize: 13,
  },
  draftRemoveBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--text3)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftRowError: {
    gridColumn: '1 / -1',
    fontSize: 12,
    color: 'var(--red)',
    background: 'rgba(196,80,64,0.08)',
    padding: '6px 10px',
    borderRadius: 6,
  },

  pickerWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  pickerInputRow: {
    display: 'flex',
    gap: 8,
  },
  pickerInput: {
    flex: 1,
    height: 40,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '0 12px',
    fontFamily: 'inherit',
    fontSize: 14,
  },
  suggestList: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
  },
  suggestRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 14px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    color: 'var(--text1)',
    textAlign: 'left',
    minHeight: 44,
  },
  suggestName: {
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  suggestUnit: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--text3)',
    textTransform: 'uppercase',
  },
  suggestEmpty: {
    padding: '14px 16px',
    color: 'var(--text3)',
    fontSize: 13,
    fontStyle: 'italic',
  },

  banner: {
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
  },
  bannerOk: {
    background: 'rgba(74,140,92,0.10)',
    color: 'var(--green)',
    border: '1px solid rgba(74,140,92,0.30)',
  },
  bannerWarn: {
    background: 'rgba(201,164,92,0.12)',
    color: '#8a6d2a',
    border: '1px solid rgba(201,164,92,0.36)',
  },
  bannerErr: {
    background: 'rgba(196,80,64,0.10)',
    color: 'var(--red)',
    border: '1px solid rgba(196,80,64,0.30)',
  },

  composerFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingTop: 14,
    borderTop: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  composerTotals: {
    display: 'flex',
    gap: 24,
    flexWrap: 'wrap',
  },
  totalCell: {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: 2,
  },
  totalLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
  },
  totalValue: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  },
  submitBtn: {
    border: '1px solid var(--text1)',
    background: 'var(--text1)',
    color: '#fff',
    padding: '12px 20px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'inherit',
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },

  // ─── Filters bar (custom layout — pills + selects mixed)
  filtersBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 18,
    alignItems: 'flex-end',
    marginBottom: 18,
    paddingTop: 4,
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  select: {
    height: 36,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '0 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    minWidth: 200,
  },

  // ─── History
  sectionTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: '0 0 12px',
  },
  historyTable: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
  },
  historyHead: {
    display: 'grid',
    gap: 14,
    padding: '12px 18px',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
  },
  historyRow: {
    display: 'grid',
    gap: 14,
    padding: '14px 18px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    fontSize: 13,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    minHeight: 56,
  },
  cellMuted: {
    color: 'var(--text2)',
    fontSize: 12,
  },
  supplyCell: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    gap: 2,
  },
  supplyName: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text1)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  notesLine: {
    fontSize: 11,
    color: 'var(--text3)',
    fontStyle: 'italic',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  qtyCell: {
    textAlign: 'right',
    fontWeight: 600,
    color: 'var(--text1)',
  },
  costCell: {
    textAlign: 'right',
    fontWeight: 600,
    color: 'var(--red)',
  },
  empty: {
    padding: '60px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
    background: 'var(--bg2)',
    border: '1px dashed var(--border)',
    borderRadius: 12,
  },
  loadMoreRow: {
    padding: 14,
    display: 'flex',
    justifyContent: 'center',
    background: 'var(--bg)',
  },
  loadMoreBtn: {
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '9px 18px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
  },
};
