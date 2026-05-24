// Inventory count — physical reconciliation of system stock against a
// manual count. Three internal screens behind the same AdminViewShell:
//
//   list   →  recent counts, grouped by date, with KPIs and a "+ New count" CTA.
//   new    →  create a check (storage + FULL/PARTIAL + supply subset).
//   detail →  the counting workspace (or read-only review for COMPLETED ones).
//
// Wiring up routing inside the view (vs. AdminMode owning multiple routes)
// keeps the shape of every admin section consistent: AdminMode opens *one*
// view, the view owns its sub-flow. Mirrors how MultiTransferView handles its
// suggestions + manual + commit phases inside a single component.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { useTranslation } from '../../../i18n';
import { formatMoney } from '../../../utils/format';
import { ApiError } from '../../../api/client';
import { Spinner } from '../../Spinner';
import {
  IconChevronLeft,
  IconChevronDown,
  IconPlus,
  IconCheck,
  IconClose,
} from '../../Icons';
import { listStorages, type Storage } from '../../../api/storages';
import { fetchAllSupplies, type SupplySummary } from '../../../api/supplies';
import {
  completeInventoryCheck,
  createInventoryCheck,
  deleteInventoryCheck,
  getInventoryCheck,
  listInventoryChecks,
  setInventoryCheckItems,
  type InventoryCheck,
  type InventoryCheckItem,
  type InventoryCheckStatus,
  type InventoryCheckType,
} from '../../../api/inventory-checks';

interface Props {
  onBack: () => void;
}

// Internal screen state — kept inside the component because the AdminMode
// router only knows about the top-level view, not its sub-flow.
type Screen =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'detail'; id: string };

type StatusFilter = 'ALL' | InventoryCheckStatus;

export function InventoryCountView({ onBack }: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });

  // Esc in the sub-screens should go back to the list, not eject the whole
  // view (the shell's Esc handler is what unmounts us). We swallow Esc *only*
  // when we're not on the list — and we use capture so we beat the shell.
  useEffect(() => {
    if (screen.kind === 'list') return;
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        setScreen({ kind: 'list' });
      }
    };
    window.addEventListener('keydown', onKey as EventListener, true);
    return () => window.removeEventListener('keydown', onKey as EventListener, true);
  }, [screen.kind]);

  if (screen.kind === 'new') {
    return (
      <NewCountScreen
        onBack={() => setScreen({ kind: 'list' })}
        onCreated={(check) => setScreen({ kind: 'detail', id: check.id })}
        onExitView={onBack}
      />
    );
  }

  if (screen.kind === 'detail') {
    return (
      <DetailScreen
        id={screen.id}
        onBack={() => setScreen({ kind: 'list' })}
        onExitView={onBack}
      />
    );
  }

  return (
    <ListScreen
      onBack={onBack}
      onNew={() => setScreen({ kind: 'new' })}
      onOpen={(id) => setScreen({ kind: 'detail', id })}
    />
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ─── Helpers ───────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

// `t()` uses {key} placeholders. Centralising the substitution keeps the call
// sites readable and types honest.
function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`,
  );
}

function isoFromInput(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDayHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Quantities arrive as strings (Prisma Decimal). Up to 4 decimals; trim
// trailing zeros so a "1.0000" doesn't look louder than a "1".
function fmtQty(value: string | number, unit?: string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '—';
  // Lock to 4-place precision, then strip the trailing zeros + dot.
  let str = num.toFixed(4).replace(/\.?0+$/, '');
  if (str === '-0') str = '0';
  return unit ? `${str} ${unit.toLowerCase()}` : str;
}

function fmtSignedQty(value: string | number, unit?: string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '—';
  if (num === 0) return fmtQty(0, unit);
  const sign = num > 0 ? '+' : '−';
  return `${sign}${fmtQty(Math.abs(num), unit)}`;
}

function fmtSignedMoney(centavos: string | number): string {
  const num = typeof centavos === 'string' ? Number(centavos) : centavos;
  if (!Number.isFinite(num)) return '—';
  if (num === 0) return formatMoney(0);
  const sign = num > 0 ? '+' : '−';
  return `${sign}${formatMoney(Math.abs(num))}`;
}

function diffColor(diff: number): string {
  if (diff === 0) return 'var(--text2)';
  if (diff < 0) return 'var(--red)';
  return 'var(--gold)';
}

function groupByDay(rows: InventoryCheck[]): Array<{ dayKey: string; iso: string; rows: InventoryCheck[] }> {
  const map = new Map<string, { iso: string; rows: InventoryCheck[] }>();
  for (const r of rows) {
    const key = dayKeyOf(new Date(r.date));
    const slot = map.get(key);
    if (slot) slot.rows.push(r);
    else map.set(key, { iso: r.date, rows: [r] });
  }
  return Array.from(map.entries()).map(([dayKey, slot]) => ({
    dayKey,
    iso: slot.iso,
    rows: slot.rows,
  }));
}

// Convenience: roll up an entire check's variance cost (centavos string).
function totalVarianceCost(check: InventoryCheck): string {
  return check.items
    .reduce((acc, item) => acc.add(new Decimal(item.difference_cost ?? '0')), new Decimal(0))
    .toFixed(0);
}

function adjustmentCount(check: InventoryCheck): number {
  return check.items.reduce(
    (n, item) => (new Decimal(item.difference ?? '0').isZero() ? n : n + 1),
    0,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ─── List screen ───────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

interface ListScreenProps {
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
}

function ListScreen({ onBack, onNew, onOpen }: ListScreenProps) {
  const { t } = useTranslation();

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [storageId, setStorageId] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const storagesQuery = useQuery({
    queryKey: ['storages', 'active'],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });

  const params = useMemo(
    () => ({
      ...(status !== 'ALL' ? { status } : {}),
      ...(storageId ? { storage_id: storageId } : {}),
      ...(isoFromInput(from) ? { from: isoFromInput(from) } : {}),
      ...(isoFromInput(to, true) ? { to: isoFromInput(to, true) } : {}),
    }),
    [status, storageId, from, to],
  );

  const checksQuery = useQuery({
    queryKey: ['inventoryChecks', params],
    queryFn: () => listInventoryChecks(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const rows = checksQuery.data?.items ?? [];
  const todayKey = useMemo(() => dayKeyOf(new Date()), []);
  const days = useMemo(() => groupByDay(rows), [rows]);

  const kpis = useMemo(() => {
    let checks = 0;
    let inProgress = 0;
    let variance = new Decimal(0);
    let adjustments = 0;
    for (const c of rows) {
      checks += 1;
      if (c.status === 'IN_PROGRESS') inProgress += 1;
      variance = variance.plus(new Decimal(totalVarianceCost(c)));
      adjustments += adjustmentCount(c);
    }
    return {
      checks,
      inProgress,
      variance: variance.toFixed(0),
      adjustments,
    };
  }, [rows]);

  return (
    <AdminViewShell
      titleKey="admin.inventoryCount.title"
      subtitleKey="admin.inventoryCount.subtitle"
      onBack={onBack}
      headerActions={
        <button
          type="button"
          style={primaryGoldBtn}
          onClick={onNew}
          aria-label={t('admin.inventoryCount.newCount')}
        >
          <IconPlus style={{ fontSize: 16 }} aria-hidden="true" />
          {t('admin.inventoryCount.newCount')}
        </button>
      }
    >
      {/* ─── Filters ─────────────────────────────────────────────────────── */}
      <div style={listFilterRow}>
        <div style={adminStyles.filterField}>
          <span style={adminStyles.filterLabel}>{t('admin.inventoryCount.filter.status')}</span>
          <div style={adminStyles.pillRow}>
            {(
              [
                ['ALL', 'admin.inventoryCount.filter.statusAll'],
                ['IN_PROGRESS', 'admin.inventoryCount.filter.statusInProgress'],
                ['COMPLETED', 'admin.inventoryCount.filter.statusCompleted'],
              ] as const
            ).map(([key, labelKey]) => (
              <button
                key={key}
                type="button"
                style={{
                  ...adminStyles.pillBtn,
                  ...(status === key ? adminStyles.pillBtnActive : null),
                }}
                onClick={() => setStatus(key)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div style={adminStyles.filterField}>
          <label htmlFor="icount-storage" style={adminStyles.filterLabel}>
            {t('admin.inventoryCount.filter.storage')}
          </label>
          <select
            id="icount-storage"
            style={selectInput}
            value={storageId}
            onChange={(e) => setStorageId(e.target.value)}
          >
            <option value="">{t('admin.inventoryCount.filter.storageAll')}</option>
            {(storagesQuery.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div style={adminStyles.filterField}>
          <label htmlFor="icount-from" style={adminStyles.filterLabel}>
            {t('admin.inventoryCount.filter.from')}
          </label>
          <input
            id="icount-from"
            type="date"
            style={adminStyles.dateInput}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div style={adminStyles.filterField}>
          <label htmlFor="icount-to" style={adminStyles.filterLabel}>
            {t('admin.inventoryCount.filter.to')}
          </label>
          <input
            id="icount-to"
            type="date"
            style={adminStyles.dateInput}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {/* ─── KPIs ────────────────────────────────────────────────────────── */}
      <div style={adminStyles.kpiRow}>
        <KpiTile label={t('admin.inventoryCount.kpi.checks')} value={String(kpis.checks)} />
        <KpiTile
          label={t('admin.inventoryCount.kpi.inProgress')}
          value={String(kpis.inProgress)}
        />
        <KpiTile
          label={t('admin.inventoryCount.kpi.variance')}
          value={fmtSignedMoney(kpis.variance)}
          tint={diffColor(Number(kpis.variance))}
        />
        <KpiTile
          label={t('admin.inventoryCount.kpi.adjustments')}
          value={String(kpis.adjustments)}
        />
      </div>

      {/* ─── List ────────────────────────────────────────────────────────── */}
      {checksQuery.isLoading ? (
        <div style={loadingBlock}>
          <Spinner />
        </div>
      ) : checksQuery.isError ? (
        <ErrorBlock onRetry={() => checksQuery.refetch()} />
      ) : days.length === 0 ? (
        <EmptyList onNew={onNew} />
      ) : (
        <div style={dayList}>
          {days.map((group) => (
            <DayGroup
              key={group.dayKey}
              dayKey={group.dayKey}
              iso={group.iso}
              rows={group.rows}
              isToday={group.dayKey === todayKey}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </AdminViewShell>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
  tint?: string;
}

function KpiTile({ label, value, tint }: KpiTileProps) {
  return (
    <div style={adminStyles.kpiCard}>
      <span style={adminStyles.kpiLabel}>{label}</span>
      <span
        style={{
          ...adminStyles.kpiValue,
          ...(tint ? { color: tint } : null),
        }}
      >
        {value}
      </span>
    </div>
  );
}

interface DayGroupProps {
  dayKey: string;
  iso: string;
  rows: InventoryCheck[];
  isToday: boolean;
  onOpen: (id: string) => void;
}

function DayGroup({ dayKey, iso, rows, isToday, onOpen }: DayGroupProps) {
  const { t } = useTranslation();
  return (
    <section style={daySection} aria-labelledby={`icount-day-${dayKey}`}>
      <header style={dayHeader}>
        <div style={dayHeaderTitle}>
          <span id={`icount-day-${dayKey}`} style={dayTitle}>
            {fmtDayHeader(iso)}
          </span>
          {isToday && (
            <span style={todayBadge}>{t('admin.inventoryCount.day.today')}</span>
          )}
        </div>
        <span style={dayCount}>
          {rows.length === 1
            ? t('admin.inventoryCount.day.oneCheck')
            : interpolate(t('admin.inventoryCount.day.nChecks'), { n: rows.length })}
        </span>
      </header>

      {/* Column labels — desktop only; the grid template defines the rhythm. */}
      <div style={listHead}>
        <span>{t('admin.inventoryCount.list.col.storage')}</span>
        <span>{t('admin.inventoryCount.list.col.type')}</span>
        <span style={cellNumHead}>{t('admin.inventoryCount.list.col.items')}</span>
        <span style={cellNumHead}>{t('admin.inventoryCount.list.col.adjustments')}</span>
        <span style={cellNumHead}>{t('admin.inventoryCount.list.col.variance')}</span>
        <span>{t('admin.inventoryCount.list.col.user')}</span>
        <span>{t('admin.inventoryCount.list.col.status')}</span>
        <span aria-hidden="true" />
      </div>

      <div style={listBody}>
        {rows.map((row) => (
          <ListRow key={row.id} row={row} onOpen={() => onOpen(row.id)} />
        ))}
      </div>
    </section>
  );
}

function ListRow({ row, onOpen }: { row: InventoryCheck; onOpen: () => void }) {
  const { t } = useTranslation();
  const variance = totalVarianceCost(row);
  const adjustments = adjustmentCount(row);
  const inProgress = row.status === 'IN_PROGRESS';
  const completedTime = row.completed_at ? fmtTime(row.completed_at) : null;

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      style={listRow}
      onClick={onOpen}
      onKeyDown={handleKey}
    >
      <div style={listCellPrimary}>
        <span style={listStorageName}>{row.storage.name}</span>
        {completedTime && row.status === 'COMPLETED' && (
          <span style={listMeta}>{completedTime}</span>
        )}
      </div>
      <span style={typePill(row.type)}>
        {row.type === 'FULL'
          ? t('admin.inventoryCount.type.full')
          : t('admin.inventoryCount.type.partial')}
      </span>
      <span style={cellNum}>{row.items.length}</span>
      <span style={{ ...cellNum, color: adjustments === 0 ? 'var(--text3)' : 'var(--text1)' }}>
        {adjustments}
      </span>
      <span style={{ ...cellNum, color: diffColor(Number(variance)), fontWeight: 600 }}>
        {fmtSignedMoney(variance)}
      </span>
      <span style={listMeta}>{row.user.name}</span>
      <span>
        {inProgress ? (
          <span style={{ ...statusPill, ...statusPillInProgress }}>
            <span style={statusDot} aria-hidden="true" />
            {t('admin.inventoryCount.status.inProgress')}
          </span>
        ) : (
          <span style={{ ...statusPill, ...statusPillCompleted }}>
            <IconCheck style={{ fontSize: 11 }} aria-hidden="true" />
            {t('admin.inventoryCount.status.completed')}
          </span>
        )}
      </span>
      <span style={listChevron} aria-hidden="true">
        <IconChevronDown style={{ fontSize: 14, transform: 'rotate(-90deg)' }} />
      </span>
    </div>
  );
}

function EmptyList({ onNew }: { onNew: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={emptyState}>
      <div style={emptyTitle}>{t('admin.inventoryCount.list.empty')}</div>
      <button type="button" style={primaryGoldBtn} onClick={onNew}>
        <IconPlus style={{ fontSize: 16 }} aria-hidden="true" />
        {t('admin.inventoryCount.list.emptyCta')}
      </button>
    </div>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={errorBlock}>
      <div style={errorTitle}>{t('common.error')}</div>
      <button type="button" style={retryBtn} onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ─── New count screen ─────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

interface NewCountScreenProps {
  onBack: () => void;
  onCreated: (check: InventoryCheck) => void;
  onExitView: () => void;
}

function NewCountScreen({ onBack, onCreated, onExitView }: NewCountScreenProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const storagesQuery = useQuery({
    queryKey: ['storages', 'active'],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });
  const suppliesQuery = useQuery({
    queryKey: ['supplies', 'all-active'],
    queryFn: () => fetchAllSupplies(),
    staleTime: 5 * 60_000,
  });

  const [storageId, setStorageId] = useState<string>('');
  const [type, setType] = useState<InventoryCheckType>('FULL');
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [supplySearch, setSupplySearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const supplies = suppliesQuery.data ?? [];
  const filteredSupplies = useMemo(() => {
    const term = supplySearch.trim().toLowerCase();
    if (!term) return supplies;
    return supplies.filter((s) => s.name.toLowerCase().includes(term));
  }, [supplies, supplySearch]);

  const createMutation = useMutation({
    mutationFn: createInventoryCheck,
    onSuccess: (check) => {
      queryClient.invalidateQueries({ queryKey: ['inventoryChecks'] });
      onCreated(check);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.error')),
  });

  function togglePick(id: string) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    if (!storageId) {
      setError(t('admin.inventoryCount.new.errorPickStorage'));
      return;
    }
    if (type === 'PARTIAL' && pickedIds.size === 0) {
      setError(t('admin.inventoryCount.new.errorPickSupplies'));
      return;
    }
    createMutation.mutate({
      storage_id: storageId,
      type,
      date: new Date().toISOString(),
      ...(type === 'PARTIAL' ? { supply_ids: Array.from(pickedIds) } : {}),
    });
  }

  const storages = storagesQuery.data ?? [];

  return (
    <AdminViewShell
      titleKey="admin.inventoryCount.title"
      subtitleKey="admin.inventoryCount.subtitle"
      onBack={onExitView}
      headerActions={
        <button type="button" style={crumbBackBtn} onClick={onBack}>
          <IconChevronLeft style={{ fontSize: 16 }} aria-hidden="true" />
          {t('common.back')}
        </button>
      }
    >
      <div style={newWrap}>
        <h3 style={sectionHeading}>{t('admin.inventoryCount.new.title')}</h3>

        {/* ─── Storage chooser ──────────────────────────────────────────── */}
        <Fieldset label={t('admin.inventoryCount.new.storageLabel')}>
          {storagesQuery.isLoading ? (
            <Spinner />
          ) : storages.length === 0 ? (
            <span style={fieldHint}>{t('admin.inventoryCount.new.storagePlaceholder')}</span>
          ) : (
            <div style={storageChips}>
              {storages.map((s) => (
                <StorageChip
                  key={s.id}
                  storage={s}
                  active={storageId === s.id}
                  onClick={() => setStorageId(s.id)}
                />
              ))}
            </div>
          )}
        </Fieldset>

        {/* ─── Type ─────────────────────────────────────────────────────── */}
        <Fieldset label={t('admin.inventoryCount.new.typeLabel')}>
          <div style={typeRow}>
            <TypeCard
              active={type === 'FULL'}
              title={t('admin.inventoryCount.type.full')}
              hint={t('admin.inventoryCount.new.typeFullHint')}
              onClick={() => setType('FULL')}
            />
            <TypeCard
              active={type === 'PARTIAL'}
              title={t('admin.inventoryCount.type.partial')}
              hint={t('admin.inventoryCount.new.typePartialHint')}
              onClick={() => setType('PARTIAL')}
            />
          </div>
        </Fieldset>

        {/* ─── Partial supplies (revealed only when PARTIAL) ────────────── */}
        {type === 'PARTIAL' && (
          <Fieldset
            label={t('admin.inventoryCount.new.suppliesLabel')}
            extra={
              pickedIds.size > 0 ? (
                <button
                  type="button"
                  style={inlineClearBtn}
                  onClick={() => setPickedIds(new Set())}
                >
                  {t('admin.inventoryCount.new.suppliesClear')}
                </button>
              ) : null
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="search"
                placeholder={t('admin.inventoryCount.new.suppliesSearch')}
                style={searchInput}
                value={supplySearch}
                onChange={(e) => setSupplySearch(e.target.value)}
              />
              {pickedIds.size > 0 && (
                <div style={pickedLine}>
                  {interpolate(t('admin.inventoryCount.new.suppliesPicked'), {
                    n: pickedIds.size,
                  })}
                </div>
              )}
              {suppliesQuery.isLoading ? (
                <div style={loadingBlock}>
                  <Spinner />
                </div>
              ) : filteredSupplies.length === 0 ? (
                <div style={inlineHintCard}>
                  {t('admin.inventoryCount.new.suppliesEmpty')}
                </div>
              ) : (
                <div style={supplyPicker}>
                  {filteredSupplies.map((s) => (
                    <SupplyChip
                      key={s.id}
                      supply={s}
                      active={pickedIds.has(s.id)}
                      onClick={() => togglePick(s.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Fieldset>
        )}

        {error && <div style={errorBanner}>{error}</div>}

        {/* ─── Footer ───────────────────────────────────────────────────── */}
        <div style={newFooter}>
          <button
            type="button"
            style={secondaryBtn}
            onClick={onBack}
            disabled={createMutation.isPending}
          >
            {t('admin.inventoryCount.new.cancel')}
          </button>
          <button
            type="button"
            style={primaryDarkBtn}
            onClick={submit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending && <Spinner size={12} />}
            {createMutation.isPending
              ? t('admin.inventoryCount.new.starting')
              : t('admin.inventoryCount.new.start')}
          </button>
        </div>
      </div>
    </AdminViewShell>
  );
}

function Fieldset({
  label,
  extra,
  children,
}: {
  label: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={fieldset}>
      <div style={fieldsetHeader}>
        <div style={fieldsetLabel}>{label}</div>
        {extra}
      </div>
      <div>{children}</div>
    </div>
  );
}

function StorageChip({
  storage,
  active,
  onClick,
}: {
  storage: Storage;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...storageChip,
        ...(active ? storageChipActive : null),
      }}
    >
      <span style={storageChipName}>{storage.name}</span>
      {storage.address && <span style={storageChipMeta}>{storage.address}</span>}
    </button>
  );
}

function TypeCard({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...typeCard,
        ...(active ? typeCardActive : null),
      }}
    >
      <span style={typeCardTitle}>{title}</span>
      <span style={typeCardHint}>{hint}</span>
    </button>
  );
}

function SupplyChip({
  supply,
  active,
  onClick,
}: {
  supply: SupplySummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...supplyChip,
        ...(active ? supplyChipActive : null),
      }}
      aria-pressed={active}
    >
      <span style={supplyChipCheck} aria-hidden="true">
        {active ? <IconCheck style={{ fontSize: 11 }} /> : null}
      </span>
      <span style={supplyChipName}>{supply.name}</span>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ─── Detail / counting screen ─────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

interface DetailScreenProps {
  id: string;
  onBack: () => void;
  onExitView: () => void;
}

// Internal per-row state. We hold the user's keystrokes as raw strings so a
// half-typed "1." doesn't snap to "1" between paints; the parsed numeric
// value gets derived on the fly.
interface RowState {
  raw: string;        // what's in the <input> right now
  touched: boolean;   // has the operator interacted with this row at all
  serverActual: string; // the actual_qty the server last confirmed for us
}

function DetailScreen({ id, onBack, onExitView }: DetailScreenProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const checkQuery = useQuery({
    queryKey: ['inventoryChecks', 'detail', id],
    queryFn: () => getInventoryCheck(id),
    placeholderData: (prev) => prev,
  });

  // Local state derived from the server data exactly once per check load.
  // We do NOT re-sync from server on every refetch — that would clobber the
  // operator's in-progress typing. Save-progress and Complete are explicit.
  const [rows, setRows] = useState<Map<string, RowState>>(new Map());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Snapshot the most recently *seen* check id so a fresh fetch for a different
  // check id resets local row state cleanly.
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    const check = checkQuery.data;
    if (!check) return;
    if (seededFor.current === check.id) return;
    seededFor.current = check.id;
    const next = new Map<string, RowState>();
    for (const item of check.items) {
      next.set(item.supply_id, {
        raw: stripTrailingZeros(item.actual_qty),
        touched: false,
        serverActual: item.actual_qty,
      });
    }
    setRows(next);
    setError(null);
  }, [checkQuery.data]);

  const check = checkQuery.data;
  const isReadOnly = check?.status === 'COMPLETED';

  // Per-row computed metrics (Δ + cost) recomputed on every keystroke. The
  // expected_qty / average_cost come from the server payload — we never
  // round-trip to recalculate cost, that keeps the UI buttery on tablets.
  const computed = useMemo(() => {
    if (!check) return new Map<string, { diff: number; cost: number; parsed: number | null }>();
    const out = new Map<string, { diff: number; cost: number; parsed: number | null }>();
    for (const item of check.items) {
      const rowState = rows.get(item.supply_id);
      const expected = new Decimal(item.expected_qty);
      // unitCost = difference_cost / difference when difference != 0; else
      // we infer from expected_qty + average via the same path the server used.
      // Easier: difference_cost was server-computed as difference * average_cost,
      // so for any *new* diff we need average_cost. Recover it from the server
      // payload by dividing whichever non-zero pair we have.
      const serverDiff = new Decimal(item.difference);
      const serverCost = new Decimal(item.difference_cost);
      let avgCost: Decimal;
      if (!serverDiff.isZero()) {
        avgCost = serverCost.div(serverDiff);
      } else {
        // Server diff is zero — average_cost wasn't echoed back to us. Fall
        // back to a conservative zero impact until the operator changes the
        // value AND the next setItems call gets us a real difference_cost.
        avgCost = new Decimal(0);
      }

      if (!rowState) {
        out.set(item.supply_id, {
          diff: 0,
          cost: Number(serverCost.toFixed(0)),
          parsed: null,
        });
        continue;
      }

      const parsed = parseQuantity(rowState.raw);
      if (parsed == null) {
        out.set(item.supply_id, { diff: NaN, cost: NaN, parsed: null });
        continue;
      }
      const newDiff = new Decimal(parsed).sub(expected);
      const newCost = newDiff.mul(avgCost);
      out.set(item.supply_id, {
        diff: Number(newDiff.toFixed(6)),
        cost: Number(newCost.toFixed(0)),
        parsed,
      });
    }
    return out;
  }, [check, rows]);

  // Filtered + summary stats.
  const filteredItems = useMemo(() => {
    if (!check) return [];
    const term = search.trim().toLowerCase();
    if (!term) return check.items;
    return check.items.filter((i) => i.supply.name.toLowerCase().includes(term));
  }, [check, search]);

  const summary = useMemo(() => {
    if (!check) {
      return {
        items: 0,
        touched: 0,
        short: 0,
        over: 0,
        matched: 0,
        untouched: 0,
        runningCost: 0,
      };
    }
    let touched = 0;
    let short = 0;
    let over = 0;
    let matched = 0;
    let runningCost = 0;
    for (const item of check.items) {
      const r = rows.get(item.supply_id);
      const c = computed.get(item.supply_id);
      if (r?.touched) touched += 1;
      if (!c) continue;
      if (Number.isFinite(c.cost)) runningCost += c.cost;
      if (c.parsed == null) continue;
      if (c.diff < 0) short += 1;
      else if (c.diff > 0) over += 1;
      else if (r?.touched) matched += 1;
    }
    return {
      items: check.items.length,
      touched,
      short,
      over,
      matched,
      untouched: check.items.length - touched,
      runningCost,
    };
  }, [check, computed, rows]);

  function updateRow(supplyId: string, raw: string) {
    if (isReadOnly) return;
    setRows((prev) => {
      const next = new Map(prev);
      const current = next.get(supplyId);
      next.set(supplyId, {
        raw,
        touched: true,
        serverActual: current?.serverActual ?? '0',
      });
      return next;
    });
  }

  function markTouched(supplyId: string) {
    if (isReadOnly) return;
    setRows((prev) => {
      const current = prev.get(supplyId);
      if (!current || current.touched) return prev;
      const next = new Map(prev);
      next.set(supplyId, { ...current, touched: true });
      return next;
    });
  }

  const setItemsMutation = useMutation({
    mutationFn: ({
      checkId,
      payload,
    }: {
      checkId: string;
      payload: Array<{ supply_id: string; actual_qty: number }>;
    }) => setInventoryCheckItems(checkId, { items: payload }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['inventoryChecks', 'detail', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['inventoryChecks'] });
      // Sync server actuals back into the local map without resetting
      // touched flags — the operator is still working.
      setRows((prev) => {
        const next = new Map(prev);
        for (const item of updated.items) {
          const current = next.get(item.supply_id);
          if (!current) continue;
          next.set(item.supply_id, {
            ...current,
            serverActual: item.actual_qty,
          });
        }
        return next;
      });
      setLastSavedAt(new Date().toISOString());
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.error')),
  });

  function saveProgress() {
    if (!check) return;
    if (isReadOnly) return;
    const payload: Array<{ supply_id: string; actual_qty: number }> = [];
    for (const item of check.items) {
      const r = rows.get(item.supply_id);
      if (!r || !r.touched) continue;
      const parsed = parseQuantity(r.raw);
      if (parsed == null) continue;
      payload.push({ supply_id: item.supply_id, actual_qty: parsed });
    }
    if (payload.length === 0) return;
    setItemsMutation.mutate({ checkId: check.id, payload });
  }

  const completeMutation = useMutation({
    mutationFn: async (checkId: string) => {
      // Always flush touched rows before completing so the server sees the
      // latest numbers. If nothing's touched, completeInventoryCheck on the
      // backend is happy to act on what's already there.
      const payload: Array<{ supply_id: string; actual_qty: number }> = [];
      if (check) {
        for (const item of check.items) {
          const r = rows.get(item.supply_id);
          if (!r || !r.touched) continue;
          const parsed = parseQuantity(r.raw);
          if (parsed == null) continue;
          payload.push({ supply_id: item.supply_id, actual_qty: parsed });
        }
      }
      if (payload.length > 0) {
        await setInventoryCheckItems(checkId, { items: payload });
      }
      return completeInventoryCheck(checkId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['inventoryChecks', 'detail', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['inventoryChecks'] });
      // Per spec — stock changed, downstream views must refresh.
      queryClient.invalidateQueries({ queryKey: ['admin-stocks'] });
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
      setConfirmComplete(false);
      setError(null);
    },
    onError: (err) => {
      setConfirmComplete(false);
      setError(err instanceof ApiError ? err.message : t('common.error'));
    },
  });

  const discardMutation = useMutation({
    mutationFn: deleteInventoryCheck,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryChecks'] });
      onBack();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.error')),
  });

  if (checkQuery.isLoading || !check) {
    return (
      <AdminViewShell
        titleKey="admin.inventoryCount.title"
        subtitleKey="admin.inventoryCount.subtitle"
        onBack={onExitView}
        headerActions={
          <button type="button" style={crumbBackBtn} onClick={onBack}>
            <IconChevronLeft style={{ fontSize: 16 }} aria-hidden="true" />
            {t('common.back')}
          </button>
        }
      >
        <div style={loadingBlock}>
          <Spinner />
        </div>
      </AdminViewShell>
    );
  }

  const runningCostColor = diffColor(summary.runningCost);

  return (
    <AdminViewShell
      titleKey="admin.inventoryCount.title"
      subtitleKey="admin.inventoryCount.subtitle"
      onBack={onExitView}
      headerActions={
        <button type="button" style={crumbBackBtn} onClick={onBack}>
          <IconChevronLeft style={{ fontSize: 16 }} aria-hidden="true" />
          {t('common.back')}
        </button>
      }
    >
      {/* ─── Header strip: storage / type / date / status / running cost ─── */}
      <div style={detailHeaderStrip}>
        <div style={detailHeaderLeft}>
          <h3 style={detailTitle}>
            {check.storage.name}
            <span style={detailTitleType}>
              {' · '}
              {check.type === 'FULL'
                ? t('admin.inventoryCount.type.full')
                : t('admin.inventoryCount.type.partial')}
            </span>
          </h3>
          <div style={detailSubMeta}>
            <span>{fmtShortDate(check.date)}</span>
            <span style={metaSep} aria-hidden="true" />
            <span>{check.user.name}</span>
            <span style={metaSep} aria-hidden="true" />
            {isReadOnly ? (
              <span style={{ ...statusPill, ...statusPillCompleted }}>
                <IconCheck style={{ fontSize: 11 }} aria-hidden="true" />
                {t('admin.inventoryCount.status.completed')}
              </span>
            ) : (
              <span style={{ ...statusPill, ...statusPillInProgress }}>
                <span style={statusDot} aria-hidden="true" />
                {t('admin.inventoryCount.status.inProgress')}
              </span>
            )}
          </div>
        </div>
        <div style={detailHeaderRight}>
          <div style={runningCostLabel}>{t('admin.inventoryCount.detail.runningCost')}</div>
          <div style={{ ...runningCostValue, color: runningCostColor }}>
            {fmtSignedMoney(summary.runningCost)}
          </div>
        </div>
      </div>

      {/* ─── Mini summary chips ──────────────────────────────────────────── */}
      <div style={summaryRow}>
        <SummaryChip
          label={interpolate(t('admin.inventoryCount.detail.summary.items'), {
            n: summary.items,
          })}
        />
        {!isReadOnly && (
          <SummaryChip
            label={interpolate(t('admin.inventoryCount.detail.summary.touched'), {
              n: summary.touched,
            })}
          />
        )}
        <SummaryChip
          label={interpolate(t('admin.inventoryCount.detail.summary.matched'), {
            n: summary.matched,
          })}
          tint="var(--green)"
        />
        <SummaryChip
          label={interpolate(t('admin.inventoryCount.detail.summary.short'), {
            n: summary.short,
          })}
          tint="var(--red)"
        />
        <SummaryChip
          label={interpolate(t('admin.inventoryCount.detail.summary.over'), {
            n: summary.over,
          })}
          tint="var(--gold)"
        />
        {!isReadOnly && summary.untouched > 0 && (
          <SummaryChip
            label={interpolate(t('admin.inventoryCount.detail.summary.untouched'), {
              n: summary.untouched,
            })}
            tint="var(--text3)"
          />
        )}
      </div>

      {/* ─── Search + read-only banner ───────────────────────────────────── */}
      <div style={detailToolbar}>
        <input
          type="search"
          placeholder={t('admin.inventoryCount.detail.search')}
          style={detailSearch}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {lastSavedAt && !isReadOnly && (
          <span style={savedAtChip}>
            {interpolate(t('admin.inventoryCount.detail.savedAt'), {
              time: fmtTime(lastSavedAt),
            })}
          </span>
        )}
      </div>

      {isReadOnly && (
        <div style={readOnlyBanner}>
          {t('admin.inventoryCount.detail.readOnly')}
        </div>
      )}

      {/* ─── The counting table ──────────────────────────────────────────── */}
      <div style={countTable}>
        <div style={countHead}>
          <span>{t('admin.inventoryCount.detail.col.supply')}</span>
          <span style={cellNumHead}>{t('admin.inventoryCount.detail.col.expected')}</span>
          <span style={cellNumHead}>{t('admin.inventoryCount.detail.col.counted')}</span>
          <span style={cellNumHead}>{t('admin.inventoryCount.detail.col.diff')}</span>
          <span style={cellNumHead}>{t('admin.inventoryCount.detail.col.cost')}</span>
        </div>
        {filteredItems.length === 0 ? (
          <div style={inlineHintCard}>
            {t('admin.inventoryCount.detail.searchEmpty')}
          </div>
        ) : (
          filteredItems.map((item) => (
            <CountRow
              key={item.id}
              item={item}
              row={rows.get(item.supply_id)}
              metric={computed.get(item.supply_id)}
              readOnly={Boolean(isReadOnly)}
              onChange={(v) => updateRow(item.supply_id, v)}
              onFocus={() => markTouched(item.supply_id)}
            />
          ))
        )}
      </div>

      {error && <div style={errorBanner}>{error}</div>}

      {/* ─── Footer actions ──────────────────────────────────────────────── */}
      {!isReadOnly && (
        <div style={detailFooter}>
          <button
            type="button"
            style={dangerGhostBtn}
            onClick={() => setConfirmDiscard(true)}
            disabled={completeMutation.isPending || discardMutation.isPending}
          >
            {t('admin.inventoryCount.detail.discard')}
          </button>
          <div style={detailFooterRight}>
            <button
              type="button"
              style={secondaryBtn}
              onClick={saveProgress}
              disabled={
                setItemsMutation.isPending ||
                completeMutation.isPending ||
                summary.touched === 0
              }
            >
              {setItemsMutation.isPending && <Spinner size={12} />}
              {setItemsMutation.isPending
                ? t('admin.inventoryCount.detail.saving')
                : t('admin.inventoryCount.detail.save')}
            </button>
            <button
              type="button"
              style={primaryGoldBtn}
              onClick={() => setConfirmComplete(true)}
              disabled={
                completeMutation.isPending || setItemsMutation.isPending
              }
            >
              {t('admin.inventoryCount.detail.complete')}
            </button>
          </div>
        </div>
      )}

      {confirmComplete && (
        <ConfirmModal
          title={t('admin.inventoryCount.detail.confirmTitle')}
          body={t('admin.inventoryCount.detail.confirmBody')}
          confirmLabel={
            completeMutation.isPending
              ? t('admin.inventoryCount.detail.completing')
              : t('admin.inventoryCount.detail.confirmBtn')
          }
          variant="gold"
          pending={completeMutation.isPending}
          onCancel={() => setConfirmComplete(false)}
          onConfirm={() => completeMutation.mutate(check.id)}
        />
      )}
      {confirmDiscard && (
        <ConfirmModal
          title={t('admin.inventoryCount.detail.discardConfirmTitle')}
          body={t('admin.inventoryCount.detail.discardConfirmBody')}
          confirmLabel={t('admin.inventoryCount.detail.discardConfirmBtn')}
          variant="danger"
          pending={discardMutation.isPending}
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => discardMutation.mutate(check.id)}
        />
      )}
    </AdminViewShell>
  );
}

function SummaryChip({ label, tint }: { label: string; tint?: string }) {
  return (
    <span
      style={{
        ...summaryChip,
        ...(tint ? { color: tint, borderColor: 'transparent', background: 'transparent' } : null),
      }}
    >
      {label}
    </span>
  );
}

// Bridge: keep the input narrow so React doesn't bail on controlled inputs.
// We parse on the way out; the input stays a string until then.
function parseQuantity(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // Accept both 12,5 and 12.5 — local conventions vary.
  const cleaned = trimmed.replace(/,/g, '.');
  if (!/^\d+(\.\d*)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function stripTrailingZeros(value: string): string {
  if (!value) return '0';
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
}

function CountRow({
  item,
  row,
  metric,
  readOnly,
  onChange,
  onFocus,
}: {
  item: InventoryCheckItem;
  row: RowState | undefined;
  metric: { diff: number; cost: number; parsed: number | null } | undefined;
  readOnly: boolean;
  onChange: (raw: string) => void;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const unit = item.supply.base_unit;
  const expected = item.expected_qty;

  const touched = row?.touched ?? false;
  const value = row?.raw ?? stripTrailingZeros(item.actual_qty);
  const parseInvalid = row != null && row.raw.trim() !== '' && metric?.parsed == null;

  const diffNum = metric?.diff ?? 0;
  const costNum = metric?.cost ?? 0;
  const diffIsValid = Number.isFinite(diffNum);
  const dColor = diffColor(diffNum);
  const isMatched = diffIsValid && diffNum === 0 && touched;

  return (
    <div
      style={{
        ...countRow,
        ...(touched || readOnly ? null : countRowUntouched),
        ...(parseInvalid ? countRowInvalid : null),
      }}
    >
      <div style={countSupplyCell}>
        <span style={countSupplyName}>{item.supply.name}</span>
        <span style={countSupplyMeta}>
          {unit.toLowerCase()}
          {!readOnly && !touched && (
            <>
              <span style={metaSep} aria-hidden="true" />
              <span style={untouchedChip}>
                {t('admin.inventoryCount.detail.untouched')}
              </span>
            </>
          )}
        </span>
      </div>

      <span style={cellNumMono}>{fmtQty(expected, unit)}</span>

      <div style={countedCell}>
        {readOnly ? (
          <span style={cellNumMono}>{fmtQty(item.actual_qty, unit)}</span>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            style={{
              ...countInput,
              ...(parseInvalid ? countInputInvalid : null),
              ...(isMatched ? countInputMatched : null),
            }}
            aria-label={item.supply.name}
          />
        )}
        {isMatched && (
          <span style={matchedCheck} aria-hidden="true">
            <IconCheck style={{ fontSize: 12 }} />
          </span>
        )}
      </div>

      <span
        style={{
          ...cellNumMono,
          color: diffIsValid && diffNum !== 0 ? dColor : 'var(--text3)',
          fontWeight: diffIsValid && diffNum !== 0 ? 600 : 500,
        }}
      >
        {diffIsValid ? fmtSignedQty(diffNum) : '—'}
      </span>
      <span
        style={{
          ...cellNumMono,
          color: Number.isFinite(costNum) && costNum !== 0 ? dColor : 'var(--text3)',
          fontWeight: Number.isFinite(costNum) && costNum !== 0 ? 600 : 500,
        }}
      >
        {Number.isFinite(costNum) ? fmtSignedMoney(costNum) : '—'}
      </span>
    </div>
  );
}

// ─── Confirm modal ─────────────────────────────────────────────────────────

interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  variant: 'gold' | 'danger';
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  variant,
  pending,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!pending) onCancel();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, pending]);

  return (
    <div style={modalScrim} onClick={pending ? undefined : onCancel}>
      <div
        style={modalCard}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header style={modalHead}>
          <div style={modalTitle}>{title}</div>
        </header>
        <div style={modalBody}>{body}</div>
        <footer style={modalFooter}>
          <button
            type="button"
            style={secondaryBtn}
            onClick={onCancel}
            disabled={pending}
          >
            <IconClose style={{ fontSize: 14 }} aria-hidden="true" />
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={variant === 'danger' ? primaryDangerBtn : primaryGoldBtn}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <Spinner size={12} />}
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ─── Styles ────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

// List grid: storage · type · items · adjustments · variance · user · status · chevron
const LIST_COLS = 'minmax(180px, 1.8fr) 90px 70px 90px 130px minmax(120px, 1fr) 130px 32px';
// Detail grid: supply · expected · counted · Δ · cost
const DETAIL_COLS = 'minmax(220px, 2fr) 130px 160px 130px 140px';

const primaryGoldBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 18px',
  borderRadius: 10,
  background: 'var(--gold)',
  color: '#2c2420',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  minHeight: 44,
  fontFamily: 'inherit',
  letterSpacing: '0.01em',
  boxShadow: '0 1px 0 rgba(44,36,32,0.05), 0 6px 18px rgba(201,164,92,0.18)',
};

const primaryDarkBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '11px 20px',
  borderRadius: 10,
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  minHeight: 44,
  fontFamily: 'inherit',
};

const primaryDangerBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 18px',
  borderRadius: 10,
  background: 'var(--red)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  minHeight: 44,
  fontFamily: 'inherit',
};

const secondaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 16px',
  borderRadius: 10,
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  minHeight: 44,
  fontFamily: 'inherit',
};

const dangerGhostBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 16px',
  borderRadius: 10,
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid rgba(196,80,64,0.32)',
  cursor: 'pointer',
  minHeight: 44,
  fontFamily: 'inherit',
};

const crumbBackBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px 8px 10px',
  borderRadius: 10,
  background: 'var(--bg2)',
  color: 'var(--text1)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  fontFamily: 'inherit',
  minHeight: 40,
};

const retryBtn: CSSProperties = {
  ...secondaryBtn,
  color: 'var(--red)',
  borderColor: 'rgba(196,80,64,0.45)',
};

const listFilterRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
  alignItems: 'flex-end',
  marginBottom: 18,
};

const selectInput: CSSProperties = {
  ...adminStyles.dateInput,
  appearance: 'auto',
  cursor: 'pointer',
  minWidth: 200,
};

const loadingBlock: CSSProperties = {
  padding: 48,
  textAlign: 'center',
};

const errorBlock: CSSProperties = {
  padding: '32px 24px',
  textAlign: 'center',
  background: 'rgba(196,80,64,0.06)',
  border: '1px solid rgba(196,80,64,0.28)',
  borderRadius: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  alignItems: 'center',
};

const errorTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--red)',
};

const errorBanner: CSSProperties = {
  marginTop: 14,
  padding: '10px 14px',
  borderRadius: 8,
  background: 'rgba(196,80,64,0.08)',
  border: '1px solid rgba(196,80,64,0.32)',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 500,
};

const dayList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 22,
};

const daySection: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  overflow: 'hidden',
  boxShadow: '0 1px 0 rgba(44,36,32,0.02), 0 2px 10px rgba(44,36,32,0.04)',
};

const dayHeader: CSSProperties = {
  padding: '14px 20px 10px',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
};

const dayHeaderTitle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
};

const dayTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text1)',
  textTransform: 'capitalize',
  letterSpacing: '-0.005em',
};

const todayBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  background: 'rgba(201,164,92,0.22)',
  color: '#7a5d2a',
};

const dayCount: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const listHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: LIST_COLS,
  alignItems: 'center',
  gap: 12,
  padding: '10px 20px',
  background: 'var(--bg)',
  borderTop: '1px solid var(--border)',
  borderBottom: '1px solid var(--border)',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const listBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const listRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: LIST_COLS,
  alignItems: 'center',
  gap: 12,
  padding: '14px 20px',
  borderBottom: '1px solid var(--border)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: 'var(--text1)',
  outline: 'none',
  minHeight: 56,
  transition: 'background 120ms cubic-bezier(0.22, 1, 0.36, 1)',
};

const listCellPrimary: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const listStorageName: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text1)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const listMeta: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const cellNumHead: CSSProperties = {
  textAlign: 'right',
};

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 13,
  color: 'var(--text1)',
};

const cellNumMono: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 13,
  color: 'var(--text1)',
};

const listChevron: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text3)',
};

const statusPill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const statusPillInProgress: CSSProperties = {
  background: 'rgba(201,164,92,0.16)',
  color: '#7a5d2a',
};

const statusPillCompleted: CSSProperties = {
  background: 'rgba(74,140,92,0.14)',
  color: 'var(--green)',
};

const statusDot: CSSProperties = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--gold)',
};

function typePill(type: InventoryCheckType): CSSProperties {
  const isFull = type === 'FULL';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 9px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: isFull ? 'var(--text1)' : 'var(--text2)',
    background: isFull ? 'rgba(44,36,32,0.07)' : 'transparent',
    border: '1px solid ' + (isFull ? 'transparent' : 'var(--border)'),
    width: 'max-content',
  };
}

const emptyState: CSSProperties = {
  padding: '64px 24px',
  textAlign: 'center',
  background: 'var(--bg2)',
  border: '1px dashed var(--border)',
  borderRadius: 14,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
};

const emptyTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text1)',
};

// ── New count screen ──────────────────────────────────────────────────────

const newWrap: CSSProperties = {
  maxWidth: 880,
  display: 'flex',
  flexDirection: 'column',
  gap: 28,
};

const sectionHeading: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
  letterSpacing: '-0.005em',
};

const fieldset: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const fieldsetHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const fieldsetLabel: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const storageChips: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: 10,
};

const storageChip: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  padding: '14px 16px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  minHeight: 64,
  transition: 'border-color 140ms cubic-bezier(0.22, 1, 0.36, 1), background 140ms',
};

const storageChipActive: CSSProperties = {
  borderColor: 'var(--text1)',
  background: 'rgba(44,36,32,0.04)',
  boxShadow: 'inset 0 0 0 1px var(--text1)',
};

const storageChipName: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text1)',
};

const storageChipMeta: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  letterSpacing: '0.04em',
};

const typeRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 12,
};

const typeCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '16px 18px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  minHeight: 76,
};

const typeCardActive: CSSProperties = {
  borderColor: 'var(--text1)',
  background: 'rgba(44,36,32,0.04)',
  boxShadow: 'inset 0 0 0 1px var(--text1)',
};

const typeCardTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 17,
  fontWeight: 600,
  color: 'var(--text1)',
};

const typeCardHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  lineHeight: 1.4,
};

const fieldHint: CSSProperties = {
  fontSize: 13,
  color: 'var(--text3)',
};

const searchInput: CSSProperties = {
  height: 40,
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg2)',
  padding: '0 14px',
  fontSize: 14,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
  maxWidth: 420,
};

const pickedLine: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  fontWeight: 600,
  letterSpacing: '0.04em',
};

const supplyPicker: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  maxHeight: 280,
  overflowY: 'auto',
  padding: 4,
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--bg2)',
};

const supplyChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px 8px 8px',
  borderRadius: 999,
  background: 'var(--bg)',
  color: 'var(--text2)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  minHeight: 36,
};

const supplyChipActive: CSSProperties = {
  background: 'var(--text1)',
  color: '#fff',
  borderColor: 'var(--text1)',
};

const supplyChipCheck: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.18)',
  color: '#fff',
  fontSize: 11,
};

const supplyChipName: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
};

const inlineHintCard: CSSProperties = {
  padding: '14px 16px',
  background: 'var(--bg2)',
  border: '1px dashed var(--border)',
  borderRadius: 12,
  color: 'var(--text3)',
  fontSize: 13,
  textAlign: 'center',
};

const inlineClearBtn: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: '4px 6px',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};

const newFooter: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 8,
};

// ── Detail screen ─────────────────────────────────────────────────────────

const detailHeaderStrip: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 16,
  padding: '6px 0 18px',
  borderBottom: '1px solid var(--border)',
  marginBottom: 14,
  flexWrap: 'wrap',
};

const detailHeaderLeft: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
};

const detailTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 26,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
  letterSpacing: '-0.01em',
};

const detailTitleType: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontWeight: 400,
  color: 'var(--text2)',
};

const detailSubMeta: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontSize: 12,
  color: 'var(--text2)',
  flexWrap: 'wrap',
};

const metaSep: CSSProperties = {
  display: 'inline-block',
  width: 3,
  height: 3,
  borderRadius: '50%',
  background: 'var(--text3)',
};

const detailHeaderRight: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 4,
};

const runningCostLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const runningCostValue: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 28,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.05,
};

const summaryRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginBottom: 14,
};

const summaryChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.02em',
  color: 'var(--text2)',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
};

const detailToolbar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 12,
};

const detailSearch: CSSProperties = {
  height: 40,
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg2)',
  padding: '0 14px',
  fontSize: 14,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
  flex: 1,
  maxWidth: 360,
};

const savedAtChip: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  letterSpacing: '0.04em',
  fontWeight: 500,
};

const readOnlyBanner: CSSProperties = {
  padding: '10px 14px',
  background: 'rgba(74,140,92,0.08)',
  border: '1px solid rgba(74,140,92,0.32)',
  borderRadius: 10,
  color: 'var(--green)',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 14,
};

const countTable: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  overflow: 'hidden',
};

const countHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: DETAIL_COLS,
  alignItems: 'center',
  gap: 16,
  padding: '12px 22px',
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const countRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: DETAIL_COLS,
  alignItems: 'center',
  gap: 16,
  padding: '12px 22px',
  borderBottom: '1px solid var(--border)',
  minHeight: 56,
  transition: 'background 140ms cubic-bezier(0.22, 1, 0.36, 1)',
};

const countRowUntouched: CSSProperties = {
  background: 'rgba(245,240,232,0.45)',
};

const countRowInvalid: CSSProperties = {
  background: 'rgba(196,80,64,0.04)',
};

const countSupplyCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const countSupplyName: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--text1)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const countSupplyMeta: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--text3)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  fontWeight: 600,
};

const untouchedChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  background: 'rgba(168,152,136,0.14)',
  color: 'var(--text3)',
};

const countedCell: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
};

const countInput: CSSProperties = {
  width: '100%',
  maxWidth: 140,
  height: 44,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  padding: '0 14px',
  fontSize: 15,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text1)',
  textAlign: 'right',
  outline: 'none',
  transition: 'border-color 140ms cubic-bezier(0.22, 1, 0.36, 1), background 140ms',
};

const countInputMatched: CSSProperties = {
  borderColor: 'rgba(74,140,92,0.55)',
  background: 'rgba(74,140,92,0.06)',
};

const countInputInvalid: CSSProperties = {
  borderColor: 'rgba(196,80,64,0.55)',
  background: 'rgba(196,80,64,0.05)',
};

const matchedCheck: CSSProperties = {
  position: 'absolute',
  left: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: 'rgba(74,140,92,0.16)',
  color: 'var(--green)',
};

const detailFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  marginTop: 18,
  paddingTop: 14,
  borderTop: '1px solid var(--border)',
};

const detailFooterRight: CSSProperties = {
  display: 'flex',
  gap: 10,
};

// ── Modal ─────────────────────────────────────────────────────────────────

const modalScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 80,
  padding: 24,
};

const modalCard: CSSProperties = {
  width: 480,
  maxWidth: '100%',
  background: 'var(--bg2)',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  overflow: 'hidden',
};

const modalHead: CSSProperties = {
  padding: '20px 22px 14px',
  borderBottom: '1px solid var(--border)',
};

const modalTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 600,
  color: 'var(--text1)',
};

const modalBody: CSSProperties = {
  padding: '16px 22px 18px',
  color: 'var(--text2)',
  fontSize: 14,
  lineHeight: 1.5,
};

const modalFooter: CSSProperties = {
  padding: '14px 22px 18px',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
};
