// Inventory · New supply — guided form for creating a brand-new SKU.
//
// Shape
//   AdminViewShell (Back · "New supply" · subtitle)
//   └─ Centered form (max-width 720px) split into four sections:
//        1. Essentials      — name / category / barcode / base unit
//                             (+ content_per_unit & content_unit when the base
//                              unit is a container shape: BOTTLE/BAG/BOX)
//        2. Per-storage min — one row per active storage, blank = skip
//        3. Packaging       — single optional supplier-side packaging
//        4. Tare            — optional, only meaningful for BOTTLE
//
// Submit fan-out
//   We POST the Supply first. If that succeeds we then fan out the optional
//   sub-creates (min-stock PATCH per storage, one POST to packagings, one PUT
//   to tare-weights). Each sub-call is allowed to fail independently — the
//   Supply itself is the only blocking step, and we surface a per-section
//   chip in the success banner so the operator sees exactly which extras
//   landed and which need to be set up later from the supplies list.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminViewShell } from './AdminViewShell';
import { useTranslation } from '../../../i18n';
import { api, ApiError, getApiBase } from '../../../api/client';
import { useSession } from '../../../store/session';
import { listStorages, type Storage } from '../../../api/storages';
import { listSuppliers } from '../../../api/suppliers';
import { Spinner } from '../../Spinner';
import { IconChevronDown } from '../../Icons';

// ─── Types (mirroring the backend schema; kept local to avoid touching
//      api/supplies.ts and api/categories.ts which are read-only here) ──────

type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';
type ContentUnit = 'ML' | 'L' | 'G' | 'KG' | 'OZ' | 'FL_OZ';

const BASE_UNITS: BaseUnit[] = ['PIECE', 'BOTTLE', 'KG', 'LITER', 'BAG', 'BOX', 'UNIT'];
const CONTENT_UNITS: ContentUnit[] = ['ML', 'L', 'G', 'KG', 'OZ', 'FL_OZ'];

// Container-style base units carry an inner measurable amount (e.g. 946ml in a
// BOTTLE). The other shapes are "what you count is what you have", so the
// content fields stay hidden — that matches the backend's bothOrNeither rule.
const CONTAINER_UNITS: ReadonlySet<BaseUnit> = new Set(['BOTTLE', 'BAG', 'BOX']);

interface SupplyCategory {
  id: string;
  name: string;
}

interface CreatedSupply {
  id: string;
  name: string;
  base_unit: BaseUnit;
}

interface CreateSupplyPayload {
  name: string;
  category_id: string;
  base_unit: BaseUnit;
  barcode?: string;
  content_per_unit?: number;
  content_unit?: ContentUnit;
  // Stamped into Supply.average_cost / Supply.last_cost on create so products
  // built from this supply aren't stuck at $0 cost until the first purchase
  // confirms. Cents integer (matches Supply.average_cost db column).
  initial_unit_cost?: number;
}

// ─── Local API helpers (no edits outside this file allowed) ───────────────

async function listSupplyCategories(): Promise<SupplyCategory[]> {
  // Drain pagination — small set (~20 in a typical café), one or two pages.
  const out: SupplyCategory[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<{ items: SupplyCategory[]; nextCursor: string | null }>(
      `/supply-categories?${sp.toString()}`,
    );
    out.push(...page.items.map((c) => ({ id: c.id, name: c.name })));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

async function createSupply(payload: CreateSupplyPayload): Promise<CreatedSupply> {
  return api.post<CreatedSupply>('/supplies', payload);
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

async function createPackaging(input: {
  supply_id: string;
  supplier_id: string;
  name: string;
  units_per_package: number;
  price_per_package?: number;
  is_primary?: boolean;
}): Promise<void> {
  await api.post<unknown>('/packagings', input);
}

// Tare-weight upsert is PUT-only on the backend; our shared `api` helper
// exposes get/post/patch/delete but not PUT. Small inline fetch routed through
// the same base URL + bearer token so behaviour matches the rest of the app.
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

// ─── Form state ───────────────────────────────────────────────────────────

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

interface SectionResult {
  ok: boolean;
  // Translation key for the per-storage / packaging / tare chip.
  messageKey: string;
}

interface SuccessReport {
  supplyId: string;
  supplyName: string;
  minStock: SectionResult[];
  packaging?: SectionResult;
  tare?: SectionResult;
}

const EMPTY_ESSENTIALS: EssentialsState = {
  name: '',
  categoryId: '',
  barcode: '',
  baseUnit: 'PIECE',
  contentPerUnit: '',
  contentUnit: 'ML',
};
const EMPTY_PACKAGING: PackagingState = {
  supplierId: '',
  name: '',
  unitsPerPackage: '',
  pricePerPackage: '',
};
const EMPTY_TARE: TareState = { empty: '', full: '', net: '' };

interface Props {
  onBack: () => void;
}

export function SupplyNewView({ onBack }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [essentials, setEssentials] = useState<EssentialsState>(EMPTY_ESSENTIALS);
  const [minStockByStorage, setMinStockByStorage] = useState<Record<string, string>>({});
  // Initial unit cost as a free-text pesos input (e.g. "12.50"). Stays empty
  // unless the operator types something or the packaging section provides a
  // derived value (in which case this input is locked and shows the formula).
  const [initialUnitCost, setInitialUnitCost] = useState<string>('');
  const [packaging, setPackaging] = useState<PackagingState>(EMPTY_PACKAGING);
  const [tare, setTare] = useState<TareState>(EMPTY_TARE);

  // Collapsible section flags. Per-storage opens by default when there are
  // few storages (the common café case); the bigger setups can leave it
  // collapsed because they likely don't want to set min-stock from this form.
  const [packagingOpen, setPackagingOpen] = useState(false);
  const [tareOpen, setTareOpen] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessReport | null>(null);

  // ─── Reference data ──────────────────────────────────────────────────────

  const categoriesQuery = useQuery({
    queryKey: ['supplyCategories'],
    queryFn: listSupplyCategories,
    staleTime: 5 * 60_000,
  });
  const storagesQuery = useQuery({
    queryKey: ['storages', { active: true }],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });
  const suppliersQuery = useQuery({
    queryKey: ['suppliers', { active: true }],
    queryFn: () => listSuppliers({ active: true }),
    staleTime: 5 * 60_000,
  });

  const categories = categoriesQuery.data ?? [];
  const storages = storagesQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];

  // Initialise the minStock map so the inputs are stable controlled components
  // from the first render. We don't touch values the operator typed.
  useEffect(() => {
    if (storages.length === 0) return;
    setMinStockByStorage((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of storages) {
        if (!(s.id in next)) {
          next[s.id] = '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [storages]);

  // Toggle the packaging fieldset disabled state when section is collapsed.
  // Same idea for tare — when the form is reset, both close again.
  function resetForm() {
    setEssentials(EMPTY_ESSENTIALS);
    setInitialUnitCost('');
    setMinStockByStorage((prev) => {
      const next: Record<string, string> = {};
      for (const k of Object.keys(prev)) next[k] = '';
      return next;
    });
    setPackaging(EMPTY_PACKAGING);
    setTare(EMPTY_TARE);
    setPackagingOpen(false);
    setTareOpen(false);
    setFormError(null);
    setSuccess(null);
  }

  // ─── Validation ──────────────────────────────────────────────────────────

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

  const packagingTouched =
    packagingOpen &&
    (packaging.supplierId !== '' ||
      packaging.name.trim() !== '' ||
      packaging.unitsPerPackage.trim() !== '' ||
      packaging.pricePerPackage.trim() !== '');

  const tareTouched =
    tareOpen &&
    (tare.empty.trim() !== '' || tare.full.trim() !== '' || tare.net.trim() !== '');

  // ─── Derived initial unit cost (from supplier packaging if complete) ────
  // When the operator fills in supplier+units+price the unit cost is
  // mathematically defined — show it (locked) so they don't have to type it
  // twice. Clearing either packaging field releases the lock.
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

  const initialCostLockedByPackaging = derivedUnitCostCents !== null;

  // Effective cents the form will submit. The lock takes precedence — the
  // operator's typed value is preserved in state, just shadowed visually.
  const effectiveInitialCostCents = useMemo<number | null>(() => {
    if (initialCostLockedByPackaging) return derivedUnitCostCents;
    const raw = initialUnitCost.trim();
    if (raw === '') return null;
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return null;
    return cents;
  }, [initialCostLockedByPackaging, derivedUnitCostCents, initialUnitCost]);

  // Pesos string used to fill the (locked) input when the derivation kicks in.
  const lockedDisplayValue =
    derivedUnitCostCents !== null
      ? (derivedUnitCostCents / 100).toFixed(2)
      : '';

  // ─── Submit fan-out ──────────────────────────────────────────────────────

  const submitMutation = useMutation({
    mutationFn: async (): Promise<SuccessReport> => {
      // ── Step 1: create the supply (blocking) ──────────────────────────
      const payload: CreateSupplyPayload = {
        name: essentials.name.trim(),
        category_id: essentials.categoryId,
        base_unit: essentials.baseUnit,
      };
      if (essentials.barcode.trim()) payload.barcode = essentials.barcode.trim();
      if (showsContent) {
        payload.content_per_unit = Number(essentials.contentPerUnit);
        payload.content_unit = essentials.contentUnit;
      }
      if (effectiveInitialCostCents !== null && effectiveInitialCostCents > 0) {
        payload.initial_unit_cost = effectiveInitialCostCents;
      }
      const created = await createSupply(payload);

      // ── Step 2: per-storage min-stock ─────────────────────────────────
      // The PATCH endpoint requires the StorageStock row to exist already;
      // on a brand-new supply none exists yet, so we expect 404s. We surface
      // those as informational chips, not errors.
      const minStockResults: SectionResult[] = [];
      for (const storage of storages) {
        const raw = minStockByStorage[storage.id];
        if (!raw || !raw.trim()) continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
          minStockResults.push({
            ok: false,
            messageKey: 'admin.supplyNew.section.minStock.invalid',
          });
          continue;
        }
        try {
          await patchStorageMinStock(storage.id, created.id, value);
          minStockResults.push({
            ok: true,
            messageKey: 'admin.supplyNew.section.minStock.set',
          });
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            // Honest message: backend won't accept min-stock until there is
            // at least one stock movement. Not a hard failure.
            minStockResults.push({
              ok: false,
              messageKey: 'admin.supplyNew.section.minStock.pending',
            });
          } else {
            minStockResults.push({
              ok: false,
              messageKey: 'admin.supplyNew.section.minStock.failed',
            });
          }
        }
      }

      // ── Step 3: supplier packaging (optional, all-or-nothing fields) ──
      let packagingResult: SectionResult | undefined;
      if (packagingTouched) {
        const units = Number(packaging.unitsPerPackage);
        const priceRaw = packaging.pricePerPackage.trim();
        const priceCents = priceRaw === '' ? undefined : Math.round(Number(priceRaw) * 100);
        const allPresent =
          packaging.supplierId !== '' &&
          packaging.name.trim() !== '' &&
          Number.isFinite(units) &&
          units > 0;
        if (!allPresent) {
          packagingResult = {
            ok: false,
            messageKey: 'admin.supplyNew.section.packaging.invalid',
          };
        } else {
          try {
            await createPackaging({
              supply_id: created.id,
              supplier_id: packaging.supplierId,
              name: packaging.name.trim(),
              units_per_package: units,
              // This is the supply's first packaging, so it's the primary
              // by definition — surface the supplier link on SupplyInfoView
              // straight away instead of waiting for the first purchase.
              is_primary: true,
              ...(priceCents !== undefined && Number.isFinite(priceCents)
                ? { price_per_package: priceCents }
                : {}),
            });
            packagingResult = {
              ok: true,
              messageKey: 'admin.supplyNew.section.packaging.created',
            };
          } catch {
            packagingResult = {
              ok: false,
              messageKey: 'admin.supplyNew.section.packaging.failed',
            };
          }
        }
      }

      // ── Step 4: tare weight (optional, only meaningful on BOTTLE) ─────
      let tareResult: SectionResult | undefined;
      if (tareTouched && tareApplicable) {
        const empty = Number(tare.empty);
        const full = Number(tare.full);
        const net = Number(tare.net);
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
            messageKey: 'admin.supplyNew.section.tare.invalid',
          };
        } else {
          try {
            await putTareWeight(created.id, {
              empty_weight_grams: empty,
              full_weight_grams: full,
              net_content: net,
            });
            tareResult = { ok: true, messageKey: 'admin.supplyNew.section.tare.set' };
          } catch {
            tareResult = {
              ok: false,
              messageKey: 'admin.supplyNew.section.tare.failed',
            };
          }
        }
      }

      return {
        supplyId: created.id,
        supplyName: created.name,
        minStock: minStockResults,
        packaging: packagingResult,
        tare: tareResult,
      };
    },
    onSuccess: (report) => {
      setSuccess(report);
      setFormError(null);
      // Invalidate every cache that lists or searches supplies / categories so
      // the next page the operator hits is fresh.
      queryClient.invalidateQueries({ queryKey: ['supplies'] });
      queryClient.invalidateQueries({ queryKey: ['admin-supplies-all'] });
      queryClient.invalidateQueries({ queryKey: ['supplyCategories'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : t('admin.supplyNew.errorGeneric');
      setFormError(msg);
    },
  });

  function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setFormError(null);
    if (!essentialsValid) {
      setFormError(t('admin.supplyNew.errorEssentials'));
      return;
    }
    if (submitMutation.isPending) return;
    submitMutation.mutate();
  }

  function startAnother() {
    resetForm();
  }

  // ─── Render: success banner replaces the form ────────────────────────────

  if (success) {
    return (
      <AdminViewShell
        titleKey="admin.supplyNew.title"
        subtitleKey="admin.supplyNew.subtitle"
        onBack={onBack}
      >
        <SuccessPane
          report={success}
          onAnother={startAnother}
          onBack={onBack}
        />
      </AdminViewShell>
    );
  }

  // ─── Render: the form ────────────────────────────────────────────────────

  const refsLoading =
    categoriesQuery.isLoading || storagesQuery.isLoading || suppliersQuery.isLoading;

  return (
    <AdminViewShell
      titleKey="admin.supplyNew.title"
      subtitleKey="admin.supplyNew.subtitle"
      onBack={onBack}
    >
      <form onSubmit={handleSubmit} style={formShell} noValidate>
        {/* ── Section 1: Essentials ───────────────────────────────────── */}
        <section style={section}>
          <SectionEyebrow label={t('admin.supplyNew.section.essentials')} />

          <Field label={t('admin.supplyNew.field.name')} required>
            <input
              type="text"
              autoFocus
              value={essentials.name}
              onChange={(e) =>
                setEssentials((s) => ({ ...s, name: e.target.value }))
              }
              placeholder={t('admin.supplyNew.placeholder.name')}
              style={textInput}
              maxLength={200}
            />
          </Field>

          <Field label={t('admin.supplyNew.field.category')} required>
            {categoriesQuery.isLoading ? (
              <div style={skeletonRow} />
            ) : categories.length === 0 ? (
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
                fontFamily:
                  'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
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
                    {t(`admin.supplyNew.unit.base.${u}`)}
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
                      {t(`admin.supplyNew.unit.content.${cu}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </section>

        {/* ── Section 1.5: Initial unit cost ─────────────────────────── */}
        {/* Sits between Essentials and Min-stock because a) it's required-ish
            (downstream products break with $0 cost) and b) the supplier
            packaging section below can fill it for you — surfacing the input
            here makes that link obvious. */}
        <section style={section}>
          <SectionEyebrow
            label={t('admin.supplyNew.section.initialCost')}
            hint={t('admin.supplyNew.section.initialCostHint')}
          />
          <Field
            label={t('admin.supplyNew.field.initialUnitCost')}
            hint={
              initialCostLockedByPackaging
                ? t('admin.supplyNew.field.initialUnitCostHintDerived')
                : t('admin.supplyNew.field.initialUnitCostHintManual')
            }
          >
            <div style={moneyWrap}>
              <span style={moneyPrefix}>$</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={initialCostLockedByPackaging ? lockedDisplayValue : initialUnitCost}
                onChange={(e) => setInitialUnitCost(e.target.value)}
                disabled={initialCostLockedByPackaging}
                placeholder="0.00"
                aria-readonly={initialCostLockedByPackaging}
                style={{
                  ...textInput,
                  paddingLeft: 26,
                  fontVariantNumeric: 'tabular-nums',
                  ...(initialCostLockedByPackaging
                    ? { background: 'var(--bg)', color: 'var(--text2)', cursor: 'not-allowed' }
                    : {}),
                }}
              />
            </div>
          </Field>
        </section>

        {/* ── Section 2: Per-storage minimums ─────────────────────────── */}
        {storagesQuery.isLoading ? (
          <section style={section}>
            <SectionEyebrow label={t('admin.supplyNew.section.minStock')} />
            <div style={skeletonRow} />
          </section>
        ) : storages.length > 0 ? (
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
                  unitLabel={t(`admin.supplyNew.unit.base.${essentials.baseUnit}`).toLowerCase()}
                  onChange={(v) =>
                    setMinStockByStorage((prev) => ({ ...prev, [s.id]: v }))
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Section 3: Supplier packaging (collapsible) ─────────────── */}
        <CollapsibleSection
          title={t('admin.supplyNew.section.packaging')}
          subtitle={t('admin.supplyNew.section.packagingHint')}
          open={packagingOpen}
          onToggle={() => setPackagingOpen((o) => !o)}
        >
          <Field label={t('admin.supplyNew.field.supplier')}>
            {suppliersQuery.isLoading ? (
              <div style={skeletonRow} />
            ) : suppliers.length === 0 ? (
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
                    setPackaging((p) => ({
                      ...p,
                      pricePerPackage: e.target.value,
                    }))
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
        </CollapsibleSection>

        {/* ── Section 4: Tare (collapsible, only for BOTTLE) ──────────── */}
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
                  value={tare.empty}
                  onChange={(e) => setTare((t) => ({ ...t, empty: e.target.value }))}
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
                  value={tare.full}
                  onChange={(e) => setTare((t) => ({ ...t, full: e.target.value }))}
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
                  value={tare.net}
                  onChange={(e) => setTare((t) => ({ ...t, net: e.target.value }))}
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

        {/* ── Form footer ─────────────────────────────────────────────── */}
        {formError && (
          <div role="alert" style={errorBanner}>
            {formError}
          </div>
        )}

        <div style={footerRow}>
          <button type="button" onClick={onBack} style={btnGhost}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!essentialsValid || submitMutation.isPending || refsLoading}
            style={{
              ...btnPrimary,
              opacity:
                !essentialsValid || submitMutation.isPending ? 0.55 : 1,
              cursor:
                !essentialsValid || submitMutation.isPending
                  ? submitMutation.isPending
                    ? 'wait'
                    : 'not-allowed'
                  : 'pointer',
            }}
          >
            {submitMutation.isPending ? (
              <>
                <Spinner size={14} />
                <span>{t('admin.supplyNew.submitting')}</span>
              </>
            ) : (
              <span>{t('admin.supplyNew.submit')}</span>
            )}
          </button>
        </div>
      </form>
    </AdminViewShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

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

// Success view — calm, single column, two clear next-actions. We deliberately
// avoid mirroring the form layout here so the operator's eye snaps to the
// completion state instead of "did I miss something?".
interface SuccessPaneProps {
  report: SuccessReport;
  onAnother: () => void;
  onBack: () => void;
}
function SuccessPane({ report, onAnother, onBack }: SuccessPaneProps) {
  const { t } = useTranslation();
  const allChips: Array<{ ok: boolean; text: string; key: string }> = [];
  report.minStock.forEach((r, i) =>
    allChips.push({ ok: r.ok, text: t(r.messageKey), key: `min-${i}` }),
  );
  if (report.packaging)
    allChips.push({
      ok: report.packaging.ok,
      text: t(report.packaging.messageKey),
      key: 'pkg',
    });
  if (report.tare)
    allChips.push({ ok: report.tare.ok, text: t(report.tare.messageKey), key: 'tare' });

  return (
    <div style={successShell}>
      <div style={successCard}>
        <span style={successEyebrow}>{t('admin.supplyNew.success.eyebrow')}</span>
        <h2 style={successHeadline}>{report.supplyName}</h2>
        <p style={successSub}>{t('admin.supplyNew.success.sub')}</p>

        {allChips.length > 0 && (
          <ul style={chipList}>
            {allChips.map((c) => (
              <li
                key={c.key}
                style={{
                  ...chip,
                  ...(c.ok ? chipOk : chipPending),
                }}
              >
                <span
                  style={{
                    ...chipDot,
                    background: c.ok ? 'var(--green)' : 'var(--gold)',
                  }}
                />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        )}

        <div style={successActions}>
          <button type="button" onClick={onAnother} style={btnPrimary}>
            {t('admin.supplyNew.success.another')}
          </button>
          <button type="button" onClick={onBack} style={btnGhost}>
            {t('admin.supplyNew.success.back')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles (local, all CSSProperties; uses tokens from styles.ts) ────────

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

const skeletonRow: CSSProperties = {
  height: 38,
  borderRadius: 8,
  background:
    'linear-gradient(90deg, rgba(216,205,184,0.30) 0%, rgba(216,205,184,0.55) 50%, rgba(216,205,184,0.30) 100%)',
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
// Last-row override handled by :last-child? We can't reach CSS easily;
// instead, the bottom border accumulates visually with the section gap.
// The container's border-radius clips the final hairline gracefully.
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

const footerRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 4,
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

// ─── Success pane styles ──────────────────────────────────────────────────

const successShell: CSSProperties = {
  maxWidth: 560,
  margin: '24px auto 0',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};
const successCard: CSSProperties = {
  width: '100%',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: '32px 36px 28px',
  boxShadow: '0 1px 0 rgba(44,36,32,0.02), 0 6px 22px rgba(44,36,32,0.04)',
};
const successEyebrow: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.32em',
  textTransform: 'uppercase',
  color: 'var(--green)',
  fontWeight: 700,
  display: 'inline-block',
  marginBottom: 12,
};
const successHeadline: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 28,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
  letterSpacing: '-0.005em',
  lineHeight: 1.15,
};
const successSub: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  margin: '6px 0 18px',
  lineHeight: 1.5,
};
const chipList: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '0 0 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid',
  fontSize: 12,
  fontWeight: 500,
  alignSelf: 'flex-start',
};
const chipOk: CSSProperties = {
  background: 'rgba(74,140,92,0.08)',
  borderColor: 'rgba(74,140,92,0.30)',
  color: 'var(--green)',
};
const chipPending: CSSProperties = {
  background: 'rgba(200,146,42,0.10)',
  borderColor: 'rgba(200,146,42,0.30)',
  color: '#8a6d2a',
};
const chipDot: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
};
const successActions: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
};
