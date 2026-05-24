// Supply · Edit — full-page form mirroring SupplyNewView so every field that
// can be set on create can be modified afterwards.
//
// Sections (top → bottom):
//   1. Essentials              — name / category / barcode / base unit + content
//   2. Current unit cost       — manual override (locked when packaging fills it)
//   3. Per-storage minimums    — one row per active storage
//   4. Primary packaging       — collapsible; supplier + name + units + price
//   5. Tare weight             — collapsible; only meaningful for BOTTLE
//
// Submit fan-out parallels SupplyNewView's: the Supply PATCH is the blocking
// step, then each sub-resource is upserted in parallel-ish (we still report
// per-section success/failure chips so the operator knows which extras saved).
//
// Backend touch points
//   GET    /api/v1/supplies/:id
//   GET    /api/v1/supply-categories
//   GET    /api/v1/storages?active=true
//   GET    /api/v1/supplies/:id/stocks
//   GET    /api/v1/suppliers?active=true
//   GET    /api/v1/packagings?supply_id=X&active=true
//   GET    /api/v1/supplies/:id/tare-weight        (404 when none)
//   PATCH  /api/v1/supplies/:id                    (now accepts unit_cost)
//   PATCH  /api/v1/storages/:id/stocks/:supplyId   (min_stock per storage)
//   POST   /api/v1/packagings             (when no primary yet)
//   PATCH  /api/v1/packagings/:id          (when primary exists)
//   DELETE /api/v1/packagings/:id          (clear primary)
//   PUT    /api/v1/supplies/:id/tare-weight         (upsert tare)
//   DELETE /api/v1/supplies/:id/tare-weight         (clear tare)
//   DELETE /api/v1/supplies/:id                    (soft-delete, footer btn)

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import { IconChevronDown } from '../../Icons';
import { useTranslation } from '../../../i18n';
import { api, ApiError, getApiBase } from '../../../api/client';
import { useSession } from '../../../store/session';
import type { PageResult } from '../../../api/pagination';
import { listStorages, type Storage } from '../../../api/storages';
import { listSuppliers } from '../../../api/suppliers';

// ─── Types ──────────────────────────────────────────────────────────────────

type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';
type ContentUnit = 'ML' | 'L' | 'G' | 'KG' | 'OZ' | 'FL_OZ';

const BASE_UNITS: BaseUnit[] = ['PIECE', 'BOTTLE', 'KG', 'LITER', 'BAG', 'BOX', 'UNIT'];
const CONTENT_UNITS: ContentUnit[] = ['ML', 'L', 'G', 'KG', 'OZ', 'FL_OZ'];

// Container shapes carry an inner measurable amount (e.g. 946ml in a BOTTLE).
// The other shapes hide the content fields — matches SupplyNewView.
const CONTAINER_UNITS: ReadonlySet<BaseUnit> = new Set(['BOTTLE', 'BAG', 'BOX']);

interface SupplyDetail {
  id: string;
  name: string;
  barcode: string | null;
  base_unit: BaseUnit;
  content_per_unit: string | null;
  content_unit: ContentUnit | null;
  category_id: string;
  active: boolean;
  deleted_at: string | null;
  average_cost: string;
  last_cost: string;
  category?: { id: string; name: string } | null;
}

interface SupplyCategory {
  id: string;
  name: string;
}

interface StorageStockRow {
  id: string;
  storage_id: string;
  supply_id?: string;
  quantity: string;
  min_stock: string | null;
}

interface PackagingRow {
  id: string;
  supply_id: string;
  supplier_id: string;
  name: string;
  units_per_package: string;
  price_per_package: string | null;
  is_primary: boolean;
  active: boolean;
}

interface TareWeightRow {
  id: string;
  supply_id: string;
  empty_weight_grams: string;
  full_weight_grams: string;
  net_content: string;
}

interface UpdateSupplyPayload {
  name?: string;
  barcode?: string | null;
  category_id?: string;
  base_unit?: BaseUnit;
  content_per_unit?: number;
  content_unit?: ContentUnit;
  active?: boolean;
  // Manual cost override — when present, backend writes to both average_cost
  // and last_cost. The next purchase confirmation recalculates the WAC.
  unit_cost?: number;
}

interface SectionResult {
  ok: boolean;
  messageKey: string;
}

interface SaveReport {
  minStock: SectionResult[];
  packaging?: SectionResult;
  tare?: SectionResult;
}

interface Props {
  supplyId: string;
  onBack: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

// ─── Data fetchers ──────────────────────────────────────────────────────────

async function fetchSupply(id: string): Promise<SupplyDetail> {
  return api.get<SupplyDetail>(`/supplies/${id}`);
}

async function fetchCategories(): Promise<SupplyCategory[]> {
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

async function fetchStocks(supplyId: string): Promise<StorageStockRow[]> {
  const out: StorageStockRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<StorageStockRow>>(
      `/supplies/${supplyId}/stocks?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

async function fetchPackagings(supplyId: string): Promise<PackagingRow[]> {
  const out: PackagingRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    sp.set('supply_id', supplyId);
    sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<PackagingRow>>(
      `/packagings?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

// The tare endpoint 404s when no row exists for the supply. We treat that as
// a normal "no tare yet" signal, not an error to surface.
async function fetchTare(supplyId: string): Promise<TareWeightRow | null> {
  try {
    return await api.get<TareWeightRow>(`/supplies/${supplyId}/tare-weight`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function patchSupply(
  supplyId: string,
  payload: UpdateSupplyPayload,
): Promise<SupplyDetail> {
  return api.patch<SupplyDetail>(`/supplies/${supplyId}`, payload);
}

async function patchStorageMinStock(
  storageId: string,
  supplyId: string,
  minStock: number,
): Promise<void> {
  await api.patch<unknown>(`/storages/${storageId}/stocks/${supplyId}`, {
    min_stock: minStock,
  });
}

async function postPackaging(input: {
  supply_id: string;
  supplier_id: string;
  name: string;
  units_per_package: number;
  price_per_package?: number;
  is_primary?: boolean;
}): Promise<void> {
  await api.post<unknown>('/packagings', input);
}

async function patchPackaging(
  id: string,
  input: {
    supplier_id?: string;
    name?: string;
    units_per_package?: number;
    price_per_package?: number | null;
    is_primary?: boolean;
  },
): Promise<void> {
  await api.patch<unknown>(`/packagings/${id}`, input);
}

async function deletePackaging(id: string): Promise<void> {
  await api.delete<unknown>(`/packagings/${id}`);
}

// Tare-weight upsert is PUT-only — `api` exposes get/post/patch/delete but
// not PUT. Small inline fetch keeps behaviour aligned with SupplyNewView.
async function putTareWeight(
  supplyId: string,
  input: {
    empty_weight_grams: number;
    full_weight_grams: number;
    net_content: number;
  },
): Promise<void> {
  const token = useSession.getState().token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${getApiBase()}/supplies/${supplyId}/tare-weight`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(text || `Tare upsert failed (${res.status})`, res.status);
  }
}

async function deleteTareWeight(supplyId: string): Promise<void> {
  await api.delete<unknown>(`/supplies/${supplyId}/tare-weight`);
}

// ─── State shapes ───────────────────────────────────────────────────────────

interface EssentialsState {
  name: string;
  categoryId: string;
  barcode: string;
  baseUnit: BaseUnit;
  contentPerUnit: string;
  contentUnit: ContentUnit;
}

interface PackagingState {
  supplierId: string;
  name: string;
  unitsPerPackage: string;
  pricePerPackage: string; // pesos, decimal input
}

interface TareState {
  empty: string;
  full: string;
  net: string;
}

const EMPTY_PACKAGING: PackagingState = {
  supplierId: '',
  name: '',
  unitsPerPackage: '',
  pricePerPackage: '',
};
const EMPTY_TARE: TareState = { empty: '', full: '', net: '' };

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplyEditView({ supplyId, onBack, onSaved, onError }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ─── Reference + per-supply data ────────────────────────────────────────

  const supplyQuery = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'detail'],
    queryFn: () => fetchSupply(supplyId),
    staleTime: 15_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ['admin', 'supplyCategories'],
    queryFn: fetchCategories,
    staleTime: 5 * 60_000,
  });
  const storagesQuery = useQuery({
    queryKey: ['storages', { active: true }],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });
  const stocksQuery = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'stocks'],
    queryFn: () => fetchStocks(supplyId),
    staleTime: 15_000,
  });
  const suppliersQuery = useQuery({
    queryKey: ['suppliers', { active: true }],
    queryFn: () => listSuppliers({ active: true }),
    staleTime: 5 * 60_000,
  });
  const packagingsQuery = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'packagings'],
    queryFn: () => fetchPackagings(supplyId),
    staleTime: 60_000,
  });
  const tareQuery = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'tareWeight'],
    queryFn: () => fetchTare(supplyId),
    staleTime: 60_000,
  });

  const supply = supplyQuery.data ?? null;
  const categories = categoriesQuery.data ?? [];
  const storages = storagesQuery.data ?? [];
  const stocks = stocksQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const packagings = packagingsQuery.data ?? [];
  const tare = tareQuery.data ?? null;

  // The single primary packaging is what this form represents. If multiple
  // exist (legacy data), we edit the one flagged primary; the rest are left
  // alone. If none is flagged, we treat the first row as a stand-in (rare
  // but possible) so the operator can fix it on save.
  const primaryPackaging = useMemo<PackagingRow | null>(() => {
    if (packagings.length === 0) return null;
    return packagings.find((p) => p.is_primary) ?? packagings[0] ?? null;
  }, [packagings]);

  // ─── Form state ────────────────────────────────────────────────────────

  const [essentials, setEssentials] = useState<EssentialsState>({
    name: '',
    categoryId: '',
    barcode: '',
    baseUnit: 'PIECE',
    contentPerUnit: '',
    contentUnit: 'ML',
  });
  const [unitCost, setUnitCost] = useState<string>(''); // pesos, decimal
  const [minStockByStorage, setMinStockByStorage] = useState<Record<string, string>>({});
  const [minStockInitial, setMinStockInitial] = useState<Record<string, string>>({});
  const [packaging, setPackaging] = useState<PackagingState>(EMPTY_PACKAGING);
  const [packagingInitial, setPackagingInitial] = useState<PackagingState>(EMPTY_PACKAGING);
  const [tareState, setTareState] = useState<TareState>(EMPTY_TARE);
  const [tareInitial, setTareInitial] = useState<TareState>(EMPTY_TARE);

  const [packagingOpen, setPackagingOpen] = useState(false);
  const [tareOpen, setTareOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Hydrate the form once all the source queries land. Re-firing on the
  // refetched supply silently overwrites unsaved edits — guarded by `hydrated`.
  useEffect(() => {
    if (hydrated) return;
    if (!supply) return;
    if (storagesQuery.isLoading || stocksQuery.isLoading) return;
    if (packagingsQuery.isLoading || tareQuery.isLoading) return;

    // Essentials
    setEssentials({
      name: supply.name,
      categoryId: supply.category_id,
      barcode: supply.barcode ?? '',
      baseUnit: supply.base_unit,
      contentPerUnit: supply.content_per_unit ?? '',
      contentUnit: supply.content_unit ?? 'ML',
    });

    // Unit cost — show in pesos (cents → decimal pesos). Empty when zero so
    // the placeholder reads as "no cost set yet" instead of "$0.00".
    const costCents = new Decimal(supply.average_cost || '0');
    const costPesos = costCents.isZero() ? '' : costCents.div(100).toFixed(2);
    setUnitCost(costPesos);

    // Min stock per storage
    const map: Record<string, string> = {};
    for (const s of storages) {
      const row = stocks.find((r) => r.storage_id === s.id);
      map[s.id] = row?.min_stock ?? '';
    }
    setMinStockByStorage(map);
    setMinStockInitial({ ...map });

    // Packaging
    if (primaryPackaging) {
      const pkg: PackagingState = {
        supplierId: primaryPackaging.supplier_id,
        name: primaryPackaging.name,
        unitsPerPackage: primaryPackaging.units_per_package,
        pricePerPackage: primaryPackaging.price_per_package
          ? new Decimal(primaryPackaging.price_per_package).div(100).toFixed(2)
          : '',
      };
      setPackaging(pkg);
      setPackagingInitial(pkg);
      setPackagingOpen(true); // pre-open since there's something to edit
    } else {
      setPackaging(EMPTY_PACKAGING);
      setPackagingInitial(EMPTY_PACKAGING);
    }

    // Tare
    if (tare) {
      const tr: TareState = {
        empty: tare.empty_weight_grams,
        full: tare.full_weight_grams,
        net: tare.net_content,
      };
      setTareState(tr);
      setTareInitial(tr);
      setTareOpen(true); // pre-open since there's something to edit
    } else {
      setTareState(EMPTY_TARE);
      setTareInitial(EMPTY_TARE);
    }

    setHydrated(true);
  }, [
    hydrated,
    supply,
    storages,
    stocks,
    primaryPackaging,
    tare,
    storagesQuery.isLoading,
    stocksQuery.isLoading,
    packagingsQuery.isLoading,
    tareQuery.isLoading,
  ]);

  // ─── Validation ────────────────────────────────────────────────────────

  const showsContent = CONTAINER_UNITS.has(essentials.baseUnit);
  const tareApplicable = essentials.baseUnit === 'BOTTLE';
  const contentPerUnitNum = essentials.contentPerUnit.trim()
    ? Number(essentials.contentPerUnit)
    : NaN;

  const essentialsValid = useMemo(() => {
    if (!essentials.name.trim()) return false;
    if (!essentials.categoryId) return false;
    if (showsContent) {
      if (!Number.isFinite(contentPerUnitNum) || contentPerUnitNum <= 0) return false;
    }
    return true;
  }, [essentials.name, essentials.categoryId, showsContent, contentPerUnitNum]);

  // Same lock semantics as SupplyNewView: when the packaging section has a
  // valid (price, units) pair the derived unit cost wins. Operator can clear
  // the packaging price or units to unlock the manual input.
  const derivedUnitCostCents = useMemo<number | null>(() => {
    const priceRaw = packaging.pricePerPackage.trim();
    const unitsRaw = packaging.unitsPerPackage.trim();
    if (priceRaw === '' || unitsRaw === '') return null;
    const priceCents = Math.round(Number(priceRaw) * 100);
    const units = Number(unitsRaw);
    if (!Number.isFinite(priceCents) || priceCents <= 0) return null;
    if (!Number.isFinite(units) || units <= 0) return null;
    return Math.round(priceCents / units);
  }, [packaging.pricePerPackage, packaging.unitsPerPackage]);

  const unitCostLockedByPackaging = derivedUnitCostCents !== null;
  const lockedDisplayValue =
    derivedUnitCostCents !== null
      ? (derivedUnitCostCents / 100).toFixed(2)
      : '';

  // What the form will submit for unit_cost (cents). null = no change.
  const effectiveUnitCostCents = useMemo<number | null>(() => {
    if (unitCostLockedByPackaging) return derivedUnitCostCents;
    const raw = unitCost.trim();
    if (raw === '') return null;
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents) || cents < 0) return null;
    return cents;
  }, [unitCostLockedByPackaging, derivedUnitCostCents, unitCost]);

  const currentUnitCostCents = supply
    ? new Decimal(supply.average_cost || '0').toDecimalPlaces(0).toNumber()
    : 0;
  const unitCostChanged =
    effectiveUnitCostCents !== null && effectiveUnitCostCents !== currentUnitCostCents;

  // ─── Submit fan-out ────────────────────────────────────────────────────

  const submitMutation = useMutation({
    mutationFn: async (): Promise<SaveReport> => {
      if (!supply) throw new Error('Supply not loaded');

      // ── Step 1: PATCH the supply (essentials + cost) ──────────────────
      const payload: UpdateSupplySupplyPayloadShape = {
        name: essentials.name.trim() || supply.name,
        category_id: essentials.categoryId,
        barcode: essentials.barcode.trim() === '' ? null : essentials.barcode.trim(),
        base_unit: essentials.baseUnit,
      };
      if (showsContent) {
        payload.content_per_unit = Number(essentials.contentPerUnit);
        payload.content_unit = essentials.contentUnit;
      }
      if (unitCostChanged) {
        payload.unit_cost = effectiveUnitCostCents!;
      }
      await patchSupply(supplyId, payload);

      // ── Step 2: per-storage min-stock — only patch the deltas ─────────
      const minStockResults: SectionResult[] = [];
      for (const storage of storages) {
        const next = (minStockByStorage[storage.id] ?? '').trim();
        const prev = (minStockInitial[storage.id] ?? '').trim();
        if (next === prev) continue; // unchanged
        if (next === '') {
          // Clearing a min stock — backend treats it as setting to 0 since
          // the PATCH schema doesn't allow null. We mirror that by sending
          // 0 explicitly.
          try {
            await patchStorageMinStock(storage.id, supplyId, 0);
            minStockResults.push({
              ok: true,
              messageKey: 'admin.supplyEdit.section.minStock.cleared',
            });
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
              minStockResults.push({
                ok: false,
                messageKey: 'admin.supplyEdit.section.minStock.pending',
              });
            } else {
              minStockResults.push({
                ok: false,
                messageKey: 'admin.supplyEdit.section.minStock.failed',
              });
            }
          }
          continue;
        }
        const value = Number(next);
        if (!Number.isFinite(value) || value < 0) {
          minStockResults.push({
            ok: false,
            messageKey: 'admin.supplyEdit.section.minStock.invalid',
          });
          continue;
        }
        try {
          await patchStorageMinStock(storage.id, supplyId, value);
          minStockResults.push({
            ok: true,
            messageKey: 'admin.supplyEdit.section.minStock.saved',
          });
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            minStockResults.push({
              ok: false,
              messageKey: 'admin.supplyEdit.section.minStock.pending',
            });
          } else {
            minStockResults.push({
              ok: false,
              messageKey: 'admin.supplyEdit.section.minStock.failed',
            });
          }
        }
      }

      // ── Step 3: primary packaging delta ───────────────────────────────
      let packagingResult: SectionResult | undefined;
      const hadPrimary = primaryPackaging !== null;
      const hasFormValues =
        packaging.supplierId !== '' ||
        packaging.name.trim() !== '' ||
        packaging.unitsPerPackage.trim() !== '' ||
        packaging.pricePerPackage.trim() !== '';
      const formIsValid =
        packaging.supplierId !== '' &&
        packaging.name.trim() !== '' &&
        Number.isFinite(Number(packaging.unitsPerPackage)) &&
        Number(packaging.unitsPerPackage) > 0;
      const packagingChanged =
        packaging.supplierId !== packagingInitial.supplierId ||
        packaging.name.trim() !== packagingInitial.name.trim() ||
        packaging.unitsPerPackage.trim() !== packagingInitial.unitsPerPackage.trim() ||
        packaging.pricePerPackage.trim() !== packagingInitial.pricePerPackage.trim();

      if (hadPrimary && !hasFormValues) {
        // Operator cleared all fields → soft-delete the existing primary.
        try {
          await deletePackaging(primaryPackaging!.id);
          packagingResult = {
            ok: true,
            messageKey: 'admin.supplyEdit.section.packaging.removed',
          };
        } catch {
          packagingResult = {
            ok: false,
            messageKey: 'admin.supplyEdit.section.packaging.failed',
          };
        }
      } else if (hadPrimary && packagingChanged) {
        if (!formIsValid) {
          packagingResult = {
            ok: false,
            messageKey: 'admin.supplyEdit.section.packaging.invalid',
          };
        } else {
          const priceRaw = packaging.pricePerPackage.trim();
          const priceCents =
            priceRaw === '' ? null : Math.round(Number(priceRaw) * 100);
          try {
            await patchPackaging(primaryPackaging!.id, {
              supplier_id: packaging.supplierId,
              name: packaging.name.trim(),
              units_per_package: Number(packaging.unitsPerPackage),
              price_per_package:
                priceCents !== null && Number.isFinite(priceCents) ? priceCents : null,
              is_primary: true,
            });
            packagingResult = {
              ok: true,
              messageKey: 'admin.supplyEdit.section.packaging.updated',
            };
          } catch {
            packagingResult = {
              ok: false,
              messageKey: 'admin.supplyEdit.section.packaging.failed',
            };
          }
        }
      } else if (!hadPrimary && hasFormValues) {
        if (!formIsValid) {
          packagingResult = {
            ok: false,
            messageKey: 'admin.supplyEdit.section.packaging.invalid',
          };
        } else {
          const priceRaw = packaging.pricePerPackage.trim();
          const priceCents = priceRaw === '' ? undefined : Math.round(Number(priceRaw) * 100);
          try {
            await postPackaging({
              supply_id: supplyId,
              supplier_id: packaging.supplierId,
              name: packaging.name.trim(),
              units_per_package: Number(packaging.unitsPerPackage),
              is_primary: true,
              ...(priceCents !== undefined && Number.isFinite(priceCents)
                ? { price_per_package: priceCents }
                : {}),
            });
            packagingResult = {
              ok: true,
              messageKey: 'admin.supplyEdit.section.packaging.created',
            };
          } catch {
            packagingResult = {
              ok: false,
              messageKey: 'admin.supplyEdit.section.packaging.failed',
            };
          }
        }
      }
      // else: nothing changed and no form values to add → no op

      // ── Step 4: tare weight (only meaningful for BOTTLE) ──────────────
      let tareResult: SectionResult | undefined;
      const hadTare = tare !== null;
      const hasTareValues =
        tareState.empty.trim() !== '' ||
        tareState.full.trim() !== '' ||
        tareState.net.trim() !== '';
      const tareChanged =
        tareState.empty.trim() !== tareInitial.empty.trim() ||
        tareState.full.trim() !== tareInitial.full.trim() ||
        tareState.net.trim() !== tareInitial.net.trim();

      if (tareApplicable) {
        if (hadTare && !hasTareValues) {
          try {
            await deleteTareWeight(supplyId);
            tareResult = {
              ok: true,
              messageKey: 'admin.supplyEdit.section.tare.removed',
            };
          } catch {
            tareResult = {
              ok: false,
              messageKey: 'admin.supplyEdit.section.tare.failed',
            };
          }
        } else if (hasTareValues && tareChanged) {
          const empty = Number(tareState.empty);
          const full = Number(tareState.full);
          const net = Number(tareState.net);
          const allValid =
            Number.isFinite(empty) &&
            empty > 0 &&
            Number.isFinite(full) &&
            full > 0 &&
            Number.isFinite(net) &&
            net > 0 &&
            full > empty;
          if (!allValid) {
            tareResult = {
              ok: false,
              messageKey: 'admin.supplyEdit.section.tare.invalid',
            };
          } else {
            try {
              await putTareWeight(supplyId, {
                empty_weight_grams: empty,
                full_weight_grams: full,
                net_content: net,
              });
              tareResult = {
                ok: true,
                messageKey: 'admin.supplyEdit.section.tare.saved',
              };
            } catch {
              tareResult = {
                ok: false,
                messageKey: 'admin.supplyEdit.section.tare.failed',
              };
            }
          }
        }
      }

      return {
        minStock: minStockResults,
        packaging: packagingResult,
        tare: tareResult,
      };
    },
    onSuccess: (report) => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'supplies'] });
      queryClient.invalidateQueries({ queryKey: ['supplies'] });

      // Roll the per-section results into a single toast. Operator sees the
      // headline; details for failures only surface if any.
      const failed: string[] = [];
      for (const r of report.minStock) if (!r.ok) failed.push(t(r.messageKey));
      if (report.packaging && !report.packaging.ok) failed.push(t(report.packaging.messageKey));
      if (report.tare && !report.tare.ok) failed.push(t(report.tare.messageKey));

      if (failed.length > 0) {
        onError(`${t('admin.supplyEdit.savedWithIssues')}: ${failed.join(' · ')}`);
      } else {
        onSaved(t('admin.supplyEdit.saved'));
      }
      onBack();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : t('admin.supplyEdit.saveFailed');
      setFormError(msg);
      onError(msg);
    },
  });

  const deactivateMut = useMutation({
    mutationFn: async () => api.delete(`/supplies/${supplyId}`),
    onSuccess: () => {
      onSaved(t('admin.supplyEdit.deactivated'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'supplies'] });
      onBack();
    },
    onError: () => onError(t('admin.supplyEdit.saveFailed')),
  });

  const reactivateMut = useMutation({
    mutationFn: async () =>
      patchSupply(supplyId, { active: true } as UpdateSupplyPayload),
    onSuccess: () => {
      onSaved(t('admin.supplyEdit.reactivated'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'supplies'] });
      onBack();
    },
    onError: () => onError(t('admin.supplyEdit.saveFailed')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!essentialsValid) {
      setFormError(t('admin.supplyEdit.errorEssentials'));
      return;
    }
    if (submitMutation.isPending) return;
    submitMutation.mutate();
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const refsLoading =
    supplyQuery.isLoading ||
    categoriesQuery.isLoading ||
    storagesQuery.isLoading ||
    stocksQuery.isLoading ||
    suppliersQuery.isLoading ||
    packagingsQuery.isLoading ||
    tareQuery.isLoading;
  const submitting =
    submitMutation.isPending ||
    deactivateMut.isPending ||
    reactivateMut.isPending;
  const isActive = supply ? supply.active && supply.deleted_at === null : false;

  return (
    <AdminViewShell
      titleKey="admin.supplyEdit.title"
      onBack={onBack}
      headerActions={
        supply ? <span style={subtitlePill}>{supply.name}</span> : undefined
      }
    >
      {refsLoading && !hydrated && (
        <div style={loaderWrap}>
          <Spinner />
        </div>
      )}

      {supply && hydrated && (
        <form onSubmit={handleSubmit} style={formShell} noValidate>
          {/* ── Section 1: Essentials ───────────────────────────────────── */}
          <section style={section}>
            <SectionEyebrow label={t('admin.supplyEdit.section.essentials')} />

            <Field label={t('admin.supplyNew.field.name')} required>
              <input
                type="text"
                value={essentials.name}
                onChange={(e) => setEssentials((s) => ({ ...s, name: e.target.value }))}
                placeholder={t('admin.supplyNew.placeholder.name')}
                style={textInput}
                maxLength={200}
              />
            </Field>

            <Field label={t('admin.supplyNew.field.category')} required>
              {categories.length === 0 ? (
                <div style={emptyHint}>{t('admin.supplyNew.noCategories')}</div>
              ) : (
                <select
                  value={essentials.categoryId}
                  onChange={(e) =>
                    setEssentials((s) => ({ ...s, categoryId: e.target.value }))
                  }
                  style={textInput}
                >
                  <option value="">{t('admin.supplyNew.field.categoryPlaceholder')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              label={t('admin.supplyNew.field.barcode')}
              hint={t('admin.supplyNew.field.barcodeHint')}
            >
              <input
                type="text"
                value={essentials.barcode}
                onChange={(e) =>
                  setEssentials((s) => ({ ...s, barcode: e.target.value }))
                }
                placeholder={t('admin.supplyNew.placeholder.barcode')}
                style={{
                  ...textInput,
                  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                  letterSpacing: '0.04em',
                }}
                maxLength={64}
              />
            </Field>

            <Field
              label={t('admin.supplyNew.field.baseUnit')}
              required
              hint={
                showsContent
                  ? t('admin.supplyNew.field.baseUnitHintContainer')
                  : t('admin.supplyNew.field.baseUnitHint')
              }
            >
              <div style={pillGroup} role="radiogroup" aria-label={t('admin.supplyNew.field.baseUnit')}>
                {BASE_UNITS.map((u) => {
                  const active = essentials.baseUnit === u;
                  return (
                    <button
                      key={u}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setEssentials((s) => ({ ...s, baseUnit: u }))}
                      style={{ ...unitPill, ...(active ? unitPillActive : {}) }}
                    >
                      {t(`admin.supplyNew.unit.base.${u}` as const)}
                    </button>
                  );
                })}
              </div>
            </Field>

            {showsContent && (
              <div style={containerInline}>
                <Field
                  label={t('admin.supplyNew.field.contentPerUnit')}
                  required
                  hint={t('admin.supplyNew.field.contentHint')}
                >
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={essentials.contentPerUnit}
                    onChange={(e) =>
                      setEssentials((s) => ({ ...s, contentPerUnit: e.target.value }))
                    }
                    placeholder={t('admin.supplyNew.placeholder.contentPerUnit')}
                    style={{ ...textInput, fontVariantNumeric: 'tabular-nums' }}
                  />
                </Field>
                <Field label={t('admin.supplyNew.field.contentUnit')} required>
                  <select
                    value={essentials.contentUnit}
                    onChange={(e) =>
                      setEssentials((s) => ({
                        ...s,
                        contentUnit: e.target.value as ContentUnit,
                      }))
                    }
                    style={textInput}
                  >
                    {CONTENT_UNITS.map((cu) => (
                      <option key={cu} value={cu}>
                        {t(`admin.supplyNew.unit.content.${cu}` as const)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </section>

          {/* ── Section 2: Current unit cost ─────────────────────────────── */}
          <section style={section}>
            <SectionEyebrow
              label={t('admin.supplyEdit.section.unitCost')}
              hint={t('admin.supplyEdit.section.unitCostHint')}
            />
            <Field
              label={t('admin.supplyNew.field.initialUnitCost')}
              hint={
                unitCostLockedByPackaging
                  ? t('admin.supplyNew.field.initialUnitCostHintDerived')
                  : t('admin.supplyEdit.field.unitCostHintManual')
              }
            >
              <div style={moneyWrap}>
                <span style={moneyPrefix}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={unitCostLockedByPackaging ? lockedDisplayValue : unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  disabled={unitCostLockedByPackaging}
                  placeholder="0.00"
                  aria-readonly={unitCostLockedByPackaging}
                  style={{
                    ...textInput,
                    paddingLeft: 26,
                    fontVariantNumeric: 'tabular-nums',
                    ...(unitCostLockedByPackaging
                      ? { background: 'var(--bg)', color: 'var(--text2)', cursor: 'not-allowed' }
                      : {}),
                  }}
                />
              </div>
            </Field>
          </section>

          {/* ── Section 3: Per-storage minimums ──────────────────────────── */}
          {storages.length > 0 && (
            <section style={section}>
              <SectionEyebrow
                label={t('admin.supplyNew.section.minStock')}
                hint={t('admin.supplyNew.section.minStockHint')}
              />
              <div style={storageList}>
                {storages.map((s) => (
                  <StorageMinRow
                    key={s.id}
                    storage={s}
                    value={minStockByStorage[s.id] ?? ''}
                    unitLabel={t(`admin.supplyNew.unit.base.${essentials.baseUnit}` as const).toLowerCase()}
                    onChange={(v) =>
                      setMinStockByStorage((prev) => ({ ...prev, [s.id]: v }))
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Section 4: Primary packaging ─────────────────────────────── */}
          <CollapsibleSection
            title={
              primaryPackaging
                ? t('admin.supplyEdit.section.packagingEdit')
                : t('admin.supplyEdit.section.packagingAdd')
            }
            subtitle={
              primaryPackaging
                ? t('admin.supplyEdit.section.packagingEditHint')
                : t('admin.supplyNew.section.packagingHint')
            }
            open={packagingOpen}
            onToggle={() => setPackagingOpen((o) => !o)}
          >
            <Field label={t('admin.supplyNew.field.supplier')}>
              {suppliers.length === 0 ? (
                <div style={emptyHint}>{t('admin.supplyNew.noSuppliers')}</div>
              ) : (
                <select
                  value={packaging.supplierId}
                  onChange={(e) =>
                    setPackaging((p) => ({ ...p, supplierId: e.target.value }))
                  }
                  style={textInput}
                >
                  <option value="">{t('admin.supplyNew.field.supplierPlaceholder')}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label={t('admin.supplyNew.field.packagingName')}
              hint={t('admin.supplyNew.field.packagingNameHint')}
            >
              <input
                type="text"
                value={packaging.name}
                onChange={(e) =>
                  setPackaging((p) => ({ ...p, name: e.target.value }))
                }
                placeholder={t('admin.supplyNew.placeholder.packagingName')}
                style={textInput}
                maxLength={200}
              />
            </Field>
            <div style={containerInline}>
              <Field label={t('admin.supplyNew.field.unitsPerPackage')}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={packaging.unitsPerPackage}
                  onChange={(e) =>
                    setPackaging((p) => ({ ...p, unitsPerPackage: e.target.value }))
                  }
                  placeholder="6"
                  style={{ ...textInput, fontVariantNumeric: 'tabular-nums' }}
                />
              </Field>
              <Field label={t('admin.supplyNew.field.pricePerPackage')}>
                <div style={moneyWrap}>
                  <span style={moneyPrefix}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={packaging.pricePerPackage}
                    onChange={(e) =>
                      setPackaging((p) => ({ ...p, pricePerPackage: e.target.value }))
                    }
                    placeholder="0.00"
                    style={{
                      ...textInput,
                      paddingLeft: 26,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                </div>
              </Field>
            </div>
            {primaryPackaging && (
              <p style={packagingNote}>
                {t('admin.supplyEdit.section.packagingClearHint')}
              </p>
            )}
          </CollapsibleSection>

          {/* ── Section 5: Tare (collapsible, only for BOTTLE) ──────────── */}
          <CollapsibleSection
            title={t('admin.supplyNew.section.tare')}
            subtitle={
              tareApplicable
                ? t('admin.supplyNew.section.tareHint')
                : t('admin.supplyNew.section.tareDisabled')
            }
            open={tareOpen}
            onToggle={() => tareApplicable && setTareOpen((o) => !o)}
            disabled={!tareApplicable}
          >
            <div style={tareGrid}>
              <Field label={t('admin.supplyNew.field.tareEmpty')}>
                <div style={moneyWrap}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={tareState.empty}
                    onChange={(e) => setTareState((t) => ({ ...t, empty: e.target.value }))}
                    placeholder="350"
                    style={{
                      ...textInput,
                      paddingRight: 36,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                  <span style={moneySuffix}>g</span>
                </div>
              </Field>
              <Field label={t('admin.supplyNew.field.tareFull')}>
                <div style={moneyWrap}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={tareState.full}
                    onChange={(e) => setTareState((t) => ({ ...t, full: e.target.value }))}
                    placeholder="1296"
                    style={{
                      ...textInput,
                      paddingRight: 36,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                  <span style={moneySuffix}>g</span>
                </div>
              </Field>
              <Field label={t('admin.supplyNew.field.tareNet')}>
                <div style={moneyWrap}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={tareState.net}
                    onChange={(e) => setTareState((t) => ({ ...t, net: e.target.value }))}
                    placeholder="946"
                    style={{
                      ...textInput,
                      paddingRight: 36,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                  <span style={moneySuffix}>
                    {essentials.contentUnit.toLowerCase().replace('_', ' ')}
                  </span>
                </div>
              </Field>
            </div>
          </CollapsibleSection>

          {/* ── Footer ──────────────────────────────────────────────────── */}
          {formError && (
            <div role="alert" style={errorBanner}>
              {formError}
            </div>
          )}

          <div style={footerRow}>
            {isActive ? (
              <button
                type="button"
                style={btnDanger}
                onClick={() => deactivateMut.mutate()}
                disabled={submitting}
              >
                {t('admin.supplyEdit.deactivate')}
              </button>
            ) : (
              <button
                type="button"
                style={btnSecondary}
                onClick={() => reactivateMut.mutate()}
                disabled={submitting}
              >
                {t('admin.supplyEdit.reactivate')}
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={btnGhost}
              onClick={onBack}
              disabled={submitting}
            >
              {t('admin.supplyEdit.cancel')}
            </button>
            <button
              type="submit"
              disabled={!essentialsValid || submitting}
              style={{
                ...btnPrimary,
                opacity: !essentialsValid || submitting ? 0.55 : 1,
                cursor:
                  !essentialsValid || submitting
                    ? submitMutation.isPending
                      ? 'wait'
                      : 'not-allowed'
                    : 'pointer',
              }}
            >
              {submitMutation.isPending ? (
                <>
                  <Spinner size={14} />
                  <span>{t('admin.supplyEdit.saving')}</span>
                </>
              ) : (
                <span>{t('admin.supplyEdit.save')}</span>
              )}
            </button>
          </div>
        </form>
      )}
    </AdminViewShell>
  );
}

// Backend payload type (re-exposed only to keep submitMutation tidy — it
// avoids a "missing field" warning when we conditionally splat unit_cost in).
type UpdateSupplySupplyPayloadShape = UpdateSupplyPayload;

// ─── Subcomponents ──────────────────────────────────────────────────────────

function SectionEyebrow({ label, hint }: { label: string; hint?: string }) {
  return (
    <header style={sectionHead}>
      <span style={sectionEyebrow}>{label}</span>
      {hint && <p style={sectionSubtitle}>{hint}</p>}
    </header>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}
function Field({ label, required, hint, children }: FieldProps) {
  return (
    <label style={fieldShell}>
      <span style={fieldLabelRow}>
        <span style={fieldLabel}>{label}</span>
        {required && <span style={fieldRequiredDot} aria-hidden="true" />}
      </span>
      {children}
      {hint && <span style={fieldHint}>{hint}</span>}
    </label>
  );
}

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}
function CollapsibleSection({
  title,
  subtitle,
  open,
  onToggle,
  disabled,
  children,
}: CollapsibleSectionProps) {
  return (
    <section
      style={{
        ...section,
        ...(disabled ? { opacity: 0.55 } : {}),
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        style={{
          ...collapseHead,
          ...(open ? collapseHeadOpen : {}),
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        aria-expanded={open}
      >
        <span style={collapseTitleBlock}>
          <span style={collapseTitle}>{title}</span>
          {subtitle && <span style={collapseSubtitle}>{subtitle}</span>}
        </span>
        <IconChevronDown
          style={{
            fontSize: 16,
            color: 'var(--text3)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </button>
      {open && !disabled && <div style={collapseBody}>{children}</div>}
    </section>
  );
}

interface StorageMinRowProps {
  storage: Storage;
  value: string;
  unitLabel: string;
  onChange: (v: string) => void;
}
function StorageMinRow({ storage, value, unitLabel, onChange }: StorageMinRowProps) {
  return (
    <div style={storageRow}>
      <span style={storageName}>{storage.name}</span>
      <div style={moneyWrap}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          style={{
            ...textInput,
            width: 130,
            textAlign: 'right',
            paddingRight: 40,
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <span style={{ ...moneySuffix, fontSize: 11 }}>{unitLabel}</span>
      </div>
    </div>
  );
}

// ─── Styles (lifted verbatim from SupplyNewView for visual parity) ─────────

const formShell: CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  paddingBottom: 24,
};

const section: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const sectionHead: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 2,
};
const sectionEyebrow: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};
const sectionSubtitle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  margin: 0,
  lineHeight: 1.45,
};

const fieldShell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const fieldLabelRow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
const fieldLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text2)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
const fieldRequiredDot: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'var(--gold)',
  display: 'inline-block',
};
const fieldHint: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  lineHeight: 1.4,
};

const textInput: CSSProperties = {
  width: '100%',
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 12px',
  fontSize: 14,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 120ms cubic-bezier(0.22, 1, 0.36, 1)',
};

const emptyHint: CSSProperties = {
  padding: '10px 12px',
  border: '1px dashed var(--border)',
  borderRadius: 8,
  color: 'var(--text3)',
  fontSize: 12,
  background: 'var(--bg2)',
};

const pillGroup: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};
const unitPill: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
};
const unitPillActive: CSSProperties = {
  background: 'var(--text1)',
  color: '#f0e0c0',
  borderColor: 'var(--text1)',
};

const containerInline: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
  gap: 12,
};

const storageList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg2)',
  overflow: 'hidden',
};
const storageRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 16px',
  borderBottom: '1px solid var(--border)',
  minHeight: 56,
};
const storageName: CSSProperties = {
  fontSize: 14,
  color: 'var(--text1)',
  fontWeight: 500,
};

const moneyWrap: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  width: '100%',
};
const moneyPrefix: CSSProperties = {
  position: 'absolute',
  left: 12,
  fontSize: 14,
  color: 'var(--text3)',
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
};
const moneySuffix: CSSProperties = {
  position: 'absolute',
  right: 12,
  fontSize: 12,
  color: 'var(--text3)',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.04em',
  pointerEvents: 'none',
};

const collapseHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 16px',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg2)',
  textAlign: 'left',
  fontFamily: 'inherit',
  minHeight: 56,
  transition: 'border-color 150ms cubic-bezier(0.22, 1, 0.36, 1)',
};
const collapseHeadOpen: CSSProperties = {
  borderColor: 'var(--text3)',
};
const collapseTitleBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};
const collapseTitle: CSSProperties = {
  fontSize: 14,
  color: 'var(--text1)',
  fontWeight: 600,
};
const collapseSubtitle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  lineHeight: 1.4,
};
const collapseBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '14px 4px 4px',
};

const tareGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 12,
};

const errorBanner: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 13,
  background: 'rgba(196,80,64,0.10)',
  color: 'var(--red)',
  border: '1px solid rgba(196,80,64,0.30)',
};

const packagingNote: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  lineHeight: 1.45,
  margin: '4px 0 0',
  fontStyle: 'italic',
};

const footerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginTop: 4,
};

const btnPrimary: CSSProperties = {
  padding: '0 22px',
  height: 48,
  minHeight: 48,
  borderRadius: 10,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  justifyContent: 'center',
  minWidth: 180,
};

const btnGhost: CSSProperties = {
  padding: '0 18px',
  height: 48,
  minHeight: 48,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 14,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const btnSecondary: CSSProperties = {
  padding: '0 18px',
  height: 40,
  minHeight: 40,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnDanger: CSSProperties = {
  padding: '0 18px',
  height: 40,
  minHeight: 40,
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const loaderWrap: CSSProperties = {
  padding: 32,
  display: 'flex',
  justifyContent: 'center',
};

const subtitlePill: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 11,
  letterSpacing: '0.04em',
  fontWeight: 500,
};
