// Insumos — admin-side review of supplies, with low-stock highlighting and a
// purchase-order drafter pinned to the right. The flow is:
//
//   1. Operator picks a receiving storage (defaults to the first active one).
//   2. The table shows every active supply with that storage's on-hand stock,
//      its min threshold and avg cost. Low-stock rows lead the list and carry
//      a red indicator.
//   3. Operator taps "+" on any row → the supply is queued in the right-hand
//      draft panel. Packagings load lazily once a supplier is also picked.
//   4. Picking the supplier + filling each line's qty/price → "Create draft
//      PO" creates a Purchase in DRAFT status (confirm + WAC happen when the
//      receiving manager confirms in the admin web).
//
// We intentionally stop at DRAFT in the terminal: confirmation triggers
// inventory deductions and weighted-average-cost recalcs that the manager
// should review once the supplies actually arrive.
//
// Self-contained shell: no dependency on AdminViewShell so this file slots
// into both the legacy and the new admin-views split without touching the
// surrounding scaffold.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { adminStyles } from '../styles';
import { IconChevronLeft, IconPlus } from '../../Icons';
import { IconTrash } from '../../operations-hub/HubIcons';
import { IconSearch } from '../icons';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import { api, ApiError } from '../../../api/client';
import type { PageResult } from '../../../api/pagination';
import { listStorages } from '../../../api/storages';
import { listSuppliers } from '../../../api/suppliers';
import {
  listPackagings,
  type PurchasePackaging,
} from '../../../api/packagings';
import {
  createPurchase,
  type CreatePurchaseInput,
} from '../../../api/purchases';

// ─── Local types ────────────────────────────────────────────────────────────

// Rich supply row returned by GET /supplies — Prisma `include: { category }`.
// We type it locally to avoid touching the existing supplies.ts (which other
// callers depend on) — additive and isolated.
interface SupplyRow {
  id: string;
  name: string;
  base_unit: string;
  content_per_unit: string | null;
  content_unit: string | null;
  average_cost: string;
  last_cost: string;
  category_id: string;
  active: boolean;
  category?: { id: string; name: string } | null;
}

interface StorageStockRow {
  id: string;
  supply_id: string;
  storage_id: string;
  quantity: string;
  min_stock: string | null;
}

interface DraftLine {
  uid: string;
  supplyId: string;
  supplyName: string;
  baseUnit: string;
  packagings: PurchasePackaging[];
  packagingsLoading: boolean;
  packagingId: string | null;
  packageQuantity: string;
  /** Editable price in PESOS (not centavos). Converted on submit. */
  pricePerPackagePesos: string;
}

interface SuppliesAdminViewProps {
  onBack: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function safeNum(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchSuppliesAll(): Promise<SupplyRow[]> {
  const out: SupplyRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<SupplyRow>>(`/supplies?${sp.toString()}`);
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 2000) break;
  } while (cursor);
  return out;
}

async function fetchStockForStorage(storageId: string): Promise<StorageStockRow[]> {
  const out: StorageStockRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<StorageStockRow>>(
      `/storages/${storageId}/stocks?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 2000) break;
  } while (cursor);
  return out;
}

function newDraftLine(supply: SupplyRow): DraftLine {
  return {
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
}

function lineTotalCentavos(line: DraftLine): number {
  const qty = safeNum(line.packageQuantity);
  const pesos = safeNum(line.pricePerPackagePesos);
  return Math.round(qty * pesos * 100);
}

function formatPesos(centavos: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(centavos / 100);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SuppliesAdminView({ onBack }: SuppliesAdminViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Esc backs out — captured so it wins over the launcher's listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        // Don't steal Esc from inputs the operator is typing in.
        const tgt = e.target as HTMLElement | null;
        const inField =
          tgt &&
          (tgt.tagName === 'INPUT' ||
            tgt.tagName === 'TEXTAREA' ||
            tgt.isContentEditable);
        if (inField) return;
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  // ── Filter state ──────────────────────────────────────────────────────
  const [storageId, setStorageId] = useState<string>('');
  const [onlyLow, setOnlyLow] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');

  // ── PO draft state ────────────────────────────────────────────────────
  const [supplierId, setSupplierId] = useState<string>('');
  const [receivingStorageId, setReceivingStorageId] = useState<string>('');
  const [date, setDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────
  const storagesQuery = useQuery({
    queryKey: ['storages', { active: true }],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });
  const storages = storagesQuery.data ?? [];

  const suppliersQuery = useQuery({
    queryKey: ['suppliers', { active: true }],
    queryFn: () => listSuppliers({ active: true }),
    staleTime: 5 * 60_000,
  });
  const suppliers = suppliersQuery.data ?? [];

  const suppliesQuery = useQuery({
    queryKey: ['admin-supplies-all'],
    queryFn: fetchSuppliesAll,
    staleTime: 30_000,
  });
  const supplies = suppliesQuery.data ?? [];

  const stocksQuery = useQuery({
    queryKey: ['admin-stocks', storageId],
    queryFn: () => fetchStockForStorage(storageId),
    enabled: Boolean(storageId),
    staleTime: 15_000,
  });
  const stocks = stocksQuery.data ?? [];

  // ── Default storage once the list arrives ─────────────────────────────
  useEffect(() => {
    if (!storagesQuery.data) return;
    if (storageId === '' && storagesQuery.data.length > 0) {
      const first = storagesQuery.data[0].id;
      setStorageId(first);
      setReceivingStorageId((cur) => cur || first);
    }
  }, [storagesQuery.data, storageId]);

  // ── Derived: supply + stock joined for the table ──────────────────────
  const stockBySupply = useMemo(() => {
    const m = new Map<string, StorageStockRow>();
    for (const s of stocks) m.set(s.supply_id, s);
    return m;
  }, [stocks]);

  interface JoinedRow {
    supply: SupplyRow;
    quantity: Decimal;
    minStock: Decimal | null;
    shortfall: Decimal;
    isLow: boolean;
  }

  const joinedRows: JoinedRow[] = useMemo(() => {
    const rows: JoinedRow[] = supplies.map((supply) => {
      const stock = stockBySupply.get(supply.id);
      const quantity = stock ? new Decimal(stock.quantity) : new Decimal(0);
      const minStock =
        stock && stock.min_stock != null ? new Decimal(stock.min_stock) : null;
      const isLow = minStock !== null && quantity.lte(minStock);
      const shortfall = isLow && minStock !== null ? minStock.minus(quantity) : new Decimal(0);
      return { supply, quantity, minStock, shortfall, isLow };
    });
    // Stable order: low-stock first (by largest shortfall), then alphabetical.
    rows.sort((a, b) => {
      if (a.isLow !== b.isLow) return a.isLow ? -1 : 1;
      if (a.isLow && b.isLow) {
        const cmp = b.shortfall.minus(a.shortfall).toNumber();
        if (cmp !== 0) return cmp;
      }
      return a.supply.name.localeCompare(b.supply.name);
    });
    return rows;
  }, [supplies, stockBySupply]);

  const lowStockCount = useMemo(() => joinedRows.filter((r) => r.isLow).length, [
    joinedRows,
  ]);

  const filteredRows: JoinedRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return joinedRows.filter((row) => {
      if (onlyLow && !row.isLow) return false;
      if (q && !row.supply.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [joinedRows, onlyLow, search]);

  const linesByOrder = lines;
  const draftedIds = useMemo(
    () => new Set(linesByOrder.map((l) => l.supplyId)),
    [linesByOrder],
  );

  // ── Banner reset on edits ─────────────────────────────────────────────
  useEffect(() => {
    setErrorBanner(null);
    setSuccessBanner(null);
  }, [supplierId, receivingStorageId, lines.length]);

  // ── Add line + packaging fetch ────────────────────────────────────────
  async function addLine(row: JoinedRow) {
    if (draftedIds.has(row.supply.id)) return;
    const line = newDraftLine(row.supply);
    setLines((prev) => [...prev, line]);
    if (supplierId) {
      await loadPackagingsForLine(line.uid, row.supply.id, supplierId);
    }
  }

  async function loadPackagingsForLine(
    lineUid: string,
    supplyId: string,
    supplierIdToUse: string,
  ) {
    patchLine(lineUid, { packagingsLoading: true });
    try {
      const list = await listPackagings({
        supply_id: supplyId,
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

  function patchLine(lineUid: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l) => (l.uid === lineUid ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(lineUid: string) {
    setLines((prev) => prev.filter((l) => l.uid !== lineUid));
  }

  // When supplier changes, every line's packaging cache is invalid — refetch
  // for each. Cleared empty if no supplier yet.
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
    // Refetch packagings for every existing line under the new supplier.
    for (const line of lines) {
      void loadPackagingsForLine(line.uid, line.supplyId, supplierId);
    }
    // We deliberately depend only on supplierId — the loop reads the current
    // lines via closure each time supplierId changes, and we don't want to
    // re-run on every line keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  // ── Mutation ──────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: (input: CreatePurchaseInput) => createPurchase(input),
    onSuccess: () => {
      setSuccessBanner(t('admin.supplies.successDraft'));
      setLines([]);
      setNotes('');
      // Refresh stocks + suppliers in case the user closes and reopens — the
      // PO itself doesn't move stock yet (DRAFT), but we kick caches so the
      // next view sees fresh data.
      queryClient.invalidateQueries({ queryKey: ['admin-stocks'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : t('common.error');
      setErrorBanner(msg);
    },
  });

  function submit() {
    setErrorBanner(null);
    if (!supplierId) {
      setErrorBanner(t('admin.supplies.errorPickSupplier'));
      return;
    }
    if (!receivingStorageId) {
      setErrorBanner(t('admin.supplies.errorPickStorage'));
      return;
    }
    if (lines.length === 0) {
      setErrorBanner(t('admin.supplies.errorNoLines'));
      return;
    }
    const itemsRaw = lines
      .filter((l) => safeNum(l.packageQuantity) > 0)
      .map((l) => ({
        supply_id: l.supplyId,
        packaging_id: l.packagingId,
        package_quantity: safeNum(l.packageQuantity),
        price_per_package: Math.round(safeNum(l.pricePerPackagePesos) * 100),
      }));
    if (itemsRaw.length === 0) {
      setErrorBanner(t('admin.supplies.errorNoLines'));
      return;
    }
    mutation.mutate({
      supplier_id: supplierId,
      storage_id: receivingStorageId,
      // Send a noon-local ISO so timezone shifts don't bump the displayed day.
      date: new Date(`${date}T12:00:00`).toISOString(),
      notes: notes.trim() || undefined,
      items: itemsRaw,
    });
  }

  // ── Layout ────────────────────────────────────────────────────────────
  const runningTotal = useMemo(
    () => lines.reduce((sum, l) => sum + lineTotalCentavos(l), 0),
    [lines],
  );
  const loading =
    storagesQuery.isLoading ||
    suppliesQuery.isLoading ||
    (Boolean(storageId) && stocksQuery.isLoading);

  return (
    <div className="admin-view-enter" style={styles.shell}>
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <div style={styles.head}>
        <button
          type="button"
          style={adminStyles.comingBack}
          onClick={onBack}
          aria-label={t('common.back')}
        >
          <IconChevronLeft style={{ fontSize: 18 }} />
          <span>{t('common.back')}</span>
        </button>
        <div style={styles.titleBlock}>
          <h2 style={styles.title}>{t('admin.supplies.title')}</h2>
          <p style={styles.subtitle}>{t('admin.supplies.subtitle')}</p>
        </div>
        <div style={styles.headStats}>
          <div style={styles.stat}>
            <span style={styles.statLabel}>{t('admin.supplies.kpi.lowStock')}</span>
            <span
              style={{
                ...styles.statValue,
                color: lowStockCount > 0 ? 'var(--red)' : 'var(--text2)',
              }}
            >
              {lowStockCount}
            </span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statLabel}>{t('admin.supplies.kpi.tracked')}</span>
            <span style={styles.statValue}>{joinedRows.length}</span>
          </div>
        </div>
      </div>

      {/* ─── Filters ───────────────────────────────────────────────────── */}
      <div style={styles.filters}>
        <label style={styles.filterField}>
          <span style={styles.filterLabel}>{t('admin.supplies.storage')}</span>
          <select
            style={styles.select}
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
        <div style={styles.searchWrap}>
          <IconSearch style={{ fontSize: 14, color: 'var(--text3)' }} />
          <input
            type="search"
            style={styles.searchInput}
            placeholder={t('admin.supplies.searchPh')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          style={{
            ...styles.toggle,
            ...(onlyLow ? styles.toggleActive : {}),
          }}
          onClick={() => setOnlyLow((v) => !v)}
        >
          {t('admin.supplies.onlyLow')}
        </button>
      </div>

      {/* ─── Body grid ─────────────────────────────────────────────────── */}
      <div style={styles.body}>
        {/* Left: supplies table */}
        <div style={styles.leftCol}>
          <div style={styles.tableShell}>
            <div style={{ ...styles.tableHead, gridTemplateColumns: COLS }}>
              <span>{t('admin.supplies.col.supply')}</span>
              <span style={alignRight}>{t('admin.supplies.col.stock')}</span>
              <span style={alignRight}>{t('admin.supplies.col.min')}</span>
              <span style={alignRight}>{t('admin.supplies.col.avgCost')}</span>
              <span />
            </div>
            <div style={styles.tableScroll}>
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <Spinner />
                </div>
              ) : filteredRows.length === 0 ? (
                <div style={styles.empty}>{t('admin.supplies.empty')}</div>
              ) : (
                filteredRows.map((row) => {
                  const inDraft = draftedIds.has(row.supply.id);
                  const avgPesos = Number(row.supply.average_cost) / 100;
                  return (
                    <div
                      key={row.supply.id}
                      style={{
                        ...styles.tableRow,
                        gridTemplateColumns: COLS,
                        borderLeft: row.isLow
                          ? '3px solid var(--red)'
                          : '3px solid transparent',
                        opacity: inDraft ? 0.55 : 1,
                      }}
                    >
                      <div style={styles.supplyCell}>
                        <span style={styles.supplyName}>{row.supply.name}</span>
                        {row.supply.category?.name && (
                          <span style={styles.categoryTag}>
                            {row.supply.category.name}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          ...alignRight,
                          color: row.isLow ? 'var(--red)' : 'var(--text1)',
                          fontWeight: row.isLow ? 600 : 500,
                        }}
                      >
                        {row.quantity.toFixed(2)}
                        <span style={styles.unitHint}> {row.supply.base_unit.toLowerCase()}</span>
                      </span>
                      <span style={{ ...alignRight, color: 'var(--text2)' }}>
                        {row.minStock !== null ? row.minStock.toFixed(2) : '—'}
                      </span>
                      <span style={{ ...alignRight, color: 'var(--text2)' }}>
                        {avgPesos > 0
                          ? formatPesos(Number(row.supply.average_cost))
                          : '—'}
                      </span>
                      <button
                        type="button"
                        style={{
                          ...styles.addBtn,
                          opacity: inDraft ? 0.4 : 1,
                          cursor: inDraft ? 'default' : 'pointer',
                        }}
                        onClick={() => void addLine(row)}
                        disabled={inDraft}
                        aria-label={t('admin.supplies.addToDraft')}
                      >
                        <IconPlus style={{ fontSize: 14 }} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: PO draft */}
        <aside style={styles.rightCol}>
          <div style={styles.poHead}>
            <h3 style={styles.poTitle}>{t('admin.supplies.poTitle')}</h3>
            <p style={styles.poSub}>{t('admin.supplies.poSubtitle')}</p>
          </div>

          <div style={styles.poBody}>
            <label style={styles.filterField}>
              <span style={styles.filterLabel}>{t('admin.supplies.supplier')}</span>
              <select
                style={styles.select}
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">{t('admin.supplies.pickSupplier')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <div style={styles.row2}>
              <label style={styles.filterField}>
                <span style={styles.filterLabel}>
                  {t('admin.supplies.receivingAt')}
                </span>
                <select
                  style={styles.select}
                  value={receivingStorageId}
                  onChange={(e) => setReceivingStorageId(e.target.value)}
                >
                  {storages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={styles.filterField}>
                <span style={styles.filterLabel}>{t('admin.supplies.date')}</span>
                <input
                  type="date"
                  style={styles.select}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>

            {lines.length === 0 ? (
              <div style={styles.poEmpty}>{t('admin.supplies.poEmpty')}</div>
            ) : (
              <div style={styles.poLines}>
                {lines.map((line) => {
                  const subtotal = lineTotalCentavos(line);
                  return (
                    <div key={line.uid} style={styles.poLine}>
                      <div style={styles.poLineHead}>
                        <span style={styles.poLineName}>{line.supplyName}</span>
                        <button
                          type="button"
                          style={styles.lineTrash}
                          onClick={() => removeLine(line.uid)}
                          aria-label="remove"
                        >
                          <IconTrash style={{ fontSize: 14 }} />
                        </button>
                      </div>
                      <div style={styles.poLineGrid}>
                        <select
                          style={{ ...styles.selectSm, gridColumn: '1 / -1' }}
                          value={line.packagingId ?? ''}
                          onChange={(e) =>
                            patchLine(line.uid, {
                              packagingId: e.target.value || null,
                              pricePerPackagePesos: (() => {
                                const pkg = line.packagings.find(
                                  (p) => p.id === e.target.value,
                                );
                                if (pkg?.price_per_package != null) {
                                  return (
                                    Number(pkg.price_per_package) / 100
                                  ).toString();
                                }
                                return line.pricePerPackagePesos;
                              })(),
                            })
                          }
                          disabled={!supplierId || line.packagingsLoading}
                        >
                          <option value="">
                            {!supplierId
                              ? t('admin.supplies.lineSupplierFirst')
                              : line.packagingsLoading
                                ? t('admin.supplies.linePackagingLoading')
                                : line.packagings.length === 0
                                  ? t('admin.supplies.linePackagingNone')
                                  : t('admin.supplies.linePackagingPick')}
                          </option>
                          {line.packagings.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>

                        <label style={styles.lineField}>
                          <span style={styles.lineFieldLabel}>
                            {t('admin.supplies.lineQty')}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            style={styles.lineInput}
                            value={line.packageQuantity}
                            onChange={(e) =>
                              patchLine(line.uid, {
                                packageQuantity: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label style={styles.lineField}>
                          <span style={styles.lineFieldLabel}>
                            {t('admin.supplies.linePrice')}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            style={styles.lineInput}
                            value={line.pricePerPackagePesos}
                            onChange={(e) =>
                              patchLine(line.uid, {
                                pricePerPackagePesos: e.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                      <div style={styles.poLineSubtotal}>
                        <span style={{ color: 'var(--text3)' }}>
                          {t('admin.supplies.lineSubtotal')}
                        </span>
                        <span style={{ fontWeight: 600 }}>
                          {formatPesos(subtotal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <label style={{ ...styles.filterField, marginTop: 14 }}>
              <span style={styles.filterLabel}>{t('admin.supplies.notes')}</span>
              <textarea
                style={styles.textarea}
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('admin.supplies.notesPh')}
                maxLength={2000}
              />
            </label>

            {errorBanner && <div style={styles.bannerErr}>{errorBanner}</div>}
            {successBanner && <div style={styles.bannerOk}>{successBanner}</div>}
          </div>

          <div style={styles.poFoot}>
            <div style={styles.poTotalRow}>
              <span style={{ color: 'var(--text3)', fontSize: 12 }}>
                {t('admin.supplies.runningTotal')}
              </span>
              <span style={styles.poTotalVal}>{formatPesos(runningTotal)}</span>
            </div>
            <button
              type="button"
              style={{
                ...styles.submitBtn,
                opacity: mutation.isPending ? 0.7 : 1,
                cursor: mutation.isPending ? 'wait' : 'pointer',
              }}
              onClick={submit}
              disabled={mutation.isPending || lines.length === 0}
            >
              {mutation.isPending
                ? t('admin.supplies.submitting')
                : t('admin.supplies.submit')}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const COLS = '1fr 110px 90px 110px 40px';
const alignRight: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const styles: Record<string, CSSProperties> = {
  shell: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    padding: '20px 32px 14px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    background: 'var(--bg2)',
  },
  titleBlock: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 24,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  subtitle: { fontSize: 12, color: 'var(--text2)', marginTop: 4 },
  headStats: { display: 'flex', gap: 22 },
  stat: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  statLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  statValue: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    marginTop: 2,
  },

  filters: {
    display: 'flex',
    gap: 12,
    padding: '14px 32px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'flex-end',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  filterField: { display: 'flex', flexDirection: 'column', gap: 4 },
  filterLabel: {
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
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
    height: 34,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg)',
    color: 'var(--text1)',
    padding: '0 8px',
    fontFamily: 'inherit',
    fontSize: 12,
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 10px',
    height: 38,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    minWidth: 220,
    flex: 1,
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: 'var(--text1)',
    flex: 1,
    fontFamily: 'inherit',
  },
  toggle: {
    height: 38,
    padding: '0 16px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text2)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.12s',
  },
  toggleActive: {
    background: 'rgba(196,80,64,0.10)',
    border: '1px solid rgba(196,80,64,0.45)',
    color: 'var(--red)',
  },

  body: {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.55fr) minmax(380px, 1fr)',
    gap: 0,
  },
  leftCol: {
    minWidth: 0,
    minHeight: 0,
    padding: '20px 32px',
    display: 'flex',
    flexDirection: 'column',
  },
  tableShell: {
    flex: 1,
    minHeight: 0,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  tableHead: {
    display: 'grid',
    gap: 12,
    padding: '12px 16px 12px 19px',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    flexShrink: 0,
  },
  tableScroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  tableRow: {
    display: 'grid',
    gap: 12,
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  },
  supplyCell: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  supplyName: { fontWeight: 500, color: 'var(--text1)' },
  categoryTag: {
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  unitHint: { color: 'var(--text3)', fontSize: 11, marginLeft: 3, fontWeight: 400 },
  addBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.12s',
  },
  empty: {
    padding: '60px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },

  rightCol: {
    minWidth: 0,
    minHeight: 0,
    background: 'var(--bg2)',
    borderLeft: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
  },
  poHead: {
    padding: '20px 22px 12px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  poTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  poSub: { fontSize: 12, color: 'var(--text3)', marginTop: 3 },
  poBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '14px 22px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  row2: { display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10 },
  poEmpty: {
    padding: '24px 14px',
    textAlign: 'center',
    fontSize: 12,
    color: 'var(--text3)',
    border: '1px dashed var(--border)',
    borderRadius: 10,
    background: 'var(--bg)',
  },
  poLines: { display: 'flex', flexDirection: 'column', gap: 10 },
  poLine: {
    padding: '12px 14px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  poLineHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  poLineName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  lineTrash: {
    width: 28,
    height: 28,
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--text3)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  poLineGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  lineField: { display: 'flex', flexDirection: 'column', gap: 3 },
  lineFieldLabel: {
    fontSize: 9,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  lineInput: {
    height: 34,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '0 8px',
    fontFamily: 'inherit',
    fontSize: 13,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  poLineSubtotal: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: 'var(--text2)',
    paddingTop: 4,
    borderTop: '1px solid var(--border)',
    fontVariantNumeric: 'tabular-nums',
  },
  textarea: {
    width: '100%',
    minHeight: 60,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    padding: '8px 10px',
    fontFamily: 'inherit',
    fontSize: 13,
    resize: 'vertical',
  },
  bannerErr: {
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 12,
    background: 'rgba(196,80,64,0.10)',
    color: 'var(--red)',
    border: '1px solid rgba(196,80,64,0.30)',
  },
  bannerOk: {
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 12,
    background: 'rgba(74,140,92,0.10)',
    color: 'var(--green)',
    border: '1px solid rgba(74,140,92,0.30)',
  },

  poFoot: {
    padding: '14px 22px 18px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg2)',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  poTotalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  poTotalVal: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  submitBtn: {
    width: '100%',
    padding: '14px 18px',
    borderRadius: 10,
    border: '1px solid var(--text1)',
    background: 'var(--text1)',
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 48,
  },
};
