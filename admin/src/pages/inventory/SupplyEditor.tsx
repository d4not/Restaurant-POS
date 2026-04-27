import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useCreateSupplyCategory,
  useSupplyCategories,
} from '../../hooks/useSupplyCategories';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useStorages } from '../../hooks/useStorages';
import {
  useCreateSupply,
  useDeleteSupply,
  useSupply,
  useSupplyStocks,
  useUpdateSupply,
} from '../../hooks/useSupplies';
import {
  useCreatePackaging,
  useDeletePackaging,
  usePackagings,
  useUpdatePackaging,
} from '../../hooks/usePackagings';
import { useConfirmPurchase, useCreatePurchase } from '../../hooks/usePurchases';
import { useMovements } from '../../hooks/useMovements';
import { ApiError } from '../../api/client';
import { formatDateTime, formatMoney, formatNumber } from '../../utils/format';
import {
  BASE_UNITS,
  CONTENT_UNITS,
  type BaseUnit,
  type ContentUnit,
  type PurchasePackaging,
  type StockMovement,
  type StorageStock,
  type Supply,
} from '../../types/inventory';
import { movementTypeTone } from './movement-meta';

// One page, three modes:
//   - create   — blank form, button "Create supply"
//   - edit     — loaded from /supplies/:id, buttons "Save changes" / "Delete"
//   - prefill  — used by quick-add: blank form seeded with OFF data and a
//                locked-in supplier on the first packaging row, button
//                "Save & next scan" (driven by saveLabel + onSaved props)
//
// The edit mode also surfaces read-only stock + movements + tare info so the
// page is the single source of truth for everything about this supply.

export interface SupplyEditorPrefill {
  barcode?: string;
  name?: string;
  image_url?: string | null;
  content_per_unit?: number | null;
  content_unit?: ContentUnit | null;
  suggestedCategories?: string[];
  source?: 'openfoodfacts' | null;
}

interface Props {
  mode: 'create' | 'edit';
  /** Used by quick-add to seed the form from a barcode lookup. */
  prefill?: SupplyEditorPrefill;
  /** Used by quick-add: lock the supplier on the first packaging row. */
  fixedSupplierId?: string;
  /** Used by quick-add: lock the destination storage for initial stock. */
  fixedStorageId?: string;
  /** When set, replaces the default save-and-redirect with this callback. */
  onSaved?: (supply: Supply) => void;
  /** Custom label for the primary save button. */
  saveLabel?: string;
  /** When true, renders without back-link/header (for embedding in QuickAdd). */
  embedded?: boolean;
}

interface BasicState {
  name: string;
  barcode: string;
  category_id: string;
  base_unit: BaseUnit | '';
  content_per_unit: string;
  content_unit: ContentUnit | '';
  active: boolean;
}

interface PackagingRow {
  // Stable client id for React keys.
  uid: string;
  // Server id for existing packagings, null for unsaved ones.
  id: string | null;
  // Locked supplier (quick-add) prevents changing this row.
  supplier_locked: boolean;
  supplier_id: string;
  name: string;
  units_per_package: string;
  price_per_package: string;
  is_primary: boolean;
  active: boolean;
  // Marked for deactivation on save (only valid when id !== null).
  removed: boolean;
  // Snapshot of the loaded values so we can diff on save.
  baseline: PackagingBaseline | null;
}

interface PackagingBaseline {
  supplier_id: string;
  name: string;
  units_per_package: string;
  price_per_package: string;
  is_primary: boolean;
  active: boolean;
}

const EMPTY_BASIC: BasicState = {
  name: '',
  barcode: '',
  category_id: '',
  base_unit: '',
  content_per_unit: '',
  content_unit: '',
  active: true,
};

function uid(): string {
  return crypto.randomUUID();
}

function newRow(overrides: Partial<PackagingRow> = {}): PackagingRow {
  return {
    uid: uid(),
    id: null,
    supplier_locked: false,
    supplier_id: '',
    name: '',
    units_per_package: '1',
    price_per_package: '',
    is_primary: false,
    active: true,
    removed: false,
    baseline: null,
    ...overrides,
  };
}

function rowFromPackaging(p: PurchasePackaging): PackagingRow {
  const fields = {
    supplier_id: p.supplier_id,
    name: p.name,
    units_per_package: String(p.units_per_package),
    price_per_package:
      p.price_per_package !== null && p.price_per_package !== undefined
        ? (Number(p.price_per_package) / 100).toString()
        : '',
    is_primary: p.is_primary,
    active: p.active,
  };
  return {
    uid: uid(),
    id: p.id,
    supplier_locked: false,
    removed: false,
    baseline: { ...fields },
    ...fields,
  };
}

function basicFromSupply(s: Supply): BasicState {
  return {
    name: s.name,
    barcode: s.barcode ?? '',
    category_id: s.category_id,
    base_unit: s.base_unit,
    content_per_unit: s.content_per_unit ?? '',
    content_unit: s.content_unit ?? '',
    active: s.active,
  };
}

function basicFromPrefill(p: SupplyEditorPrefill | undefined): BasicState {
  if (!p) return EMPTY_BASIC;
  return {
    ...EMPTY_BASIC,
    name: p.name ?? '',
    barcode: p.barcode ?? '',
    content_per_unit:
      p.content_per_unit !== null && p.content_per_unit !== undefined
        ? String(p.content_per_unit)
        : '',
    content_unit: p.content_unit ?? '',
  };
}

function rowChanged(row: PackagingRow): boolean {
  if (!row.baseline) return true;
  const b = row.baseline;
  return (
    b.name !== row.name.trim() ||
    Number(b.units_per_package) !== Number(row.units_per_package) ||
    b.price_per_package !== row.price_per_package.trim() ||
    b.is_primary !== row.is_primary ||
    b.active !== row.active
  );
}

export function SupplyEditor({
  mode,
  prefill,
  fixedSupplierId,
  fixedStorageId,
  onSaved,
  saveLabel,
  embedded = false,
}: Props) {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const supplyId = mode === 'edit' ? params.id : undefined;

  const supplyQ = useSupply(supplyId);
  const stocksQ = useSupplyStocks(supplyId);
  const packagingsQ = usePackagings({ supply_id: supplyId });
  const movementsQ = useMovements({ supply_id: supplyId });
  const categoriesQ = useSupplyCategories();
  const suppliersQ = useSuppliers({ active: true });
  const storagesQ = useStorages();

  const createSupplyM = useCreateSupply();
  const updateSupplyM = useUpdateSupply();
  const deleteSupplyM = useDeleteSupply();
  const createPackagingM = useCreatePackaging();
  const updatePackagingM = useUpdatePackaging();
  const deletePackagingM = useDeletePackaging();
  const createCategoryM = useCreateSupplyCategory();
  const createPurchaseM = useCreatePurchase();
  const confirmPurchaseM = useConfirmPurchase();

  const [basic, setBasic] = useState<BasicState>(() => basicFromPrefill(prefill));
  const [rows, setRows] = useState<PackagingRow[]>(() => {
    if (fixedSupplierId) {
      return [
        newRow({
          supplier_locked: true,
          supplier_id: fixedSupplierId,
          is_primary: true,
          name: prefill?.content_per_unit && prefill?.content_unit
            ? `Bottle (${prefill.content_per_unit} ${prefill.content_unit.toLowerCase()})`
            : '',
        }),
      ];
    }
    return [];
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Inline category creation — toggled by "+ New category" link next to the
  // category dropdown. Saves through the standard create endpoint and the
  // useSupplyCategories cache invalidates so the new option appears.
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);

  // Initial stock — when set on a NEW supply, save also creates + confirms
  // a one-line Purchase so the supply lands in the system with real WAC and
  // a real stock balance instead of a zero row.
  const [initialStorageId, setInitialStorageId] = useState<string>(
    fixedStorageId ?? '',
  );
  const [initialQuantity, setInitialQuantity] = useState<string>('');

  // Track whether we've already hydrated from the loaded supply, so re-fetches
  // from invalidations don't blow away unsaved edits.
  const hydratedSupplyId = useRef<string | null>(null);
  const hydratedPackagingsId = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !supplyQ.data) return;
    if (hydratedSupplyId.current === supplyQ.data.id) return;
    setBasic(basicFromSupply(supplyQ.data));
    hydratedSupplyId.current = supplyQ.data.id;
  }, [mode, supplyQ.data]);

  useEffect(() => {
    if (mode !== 'edit' || !packagingsQ.data || !supplyId) return;
    if (hydratedPackagingsId.current === supplyId) return;
    setRows(packagingsQ.data.items.map(rowFromPackaging));
    hydratedPackagingsId.current = supplyId;
  }, [mode, packagingsQ.data, supplyId]);

  // ── Derived ──
  const suppliers = useMemo(
    () => suppliersQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliersQ.data],
  );
  // Kept for reference; not currently displayed in the editor header.
  void ((id: string): string | null =>
    suppliers.find((s) => s.id === id)?.name ?? null);

  const visibleRows = useMemo(() => rows.filter((r) => !r.removed), [rows]);

  const storages = useMemo(
    () => storagesQ.data?.items.filter((s) => s.active) ?? [],
    [storagesQ.data],
  );

  // Pick which packaging row drives the initial purchase: the row marked
  // primary (if it has a price), otherwise the first row with a price set.
  const initialPurchasePackaging = useMemo(() => {
    const withPrice = visibleRows.filter((r) => r.price_per_package.trim() !== '');
    return (
      withPrice.find((r) => r.is_primary) ?? withPrice[0] ?? null
    );
  }, [visibleRows]);

  const totalStock = useMemo(() => {
    if (mode !== 'edit' || !stocksQ.data) return 0;
    return stocksQ.data.items.reduce((acc, s) => acc + Number(s.quantity), 0);
  }, [mode, stocksQ.data]);

  const movements = useMemo(
    () => movementsQ.data?.pages.flatMap((p) => p.items) ?? [],
    [movementsQ.data],
  );

  // ── State helpers ──
  const setField = <K extends keyof BasicState>(key: K, value: BasicState[K]) =>
    setBasic((b) => ({ ...b, [key]: value }));

  const updateRow = (rowUid: string, patch: Partial<PackagingRow>) =>
    setRows((prev) => prev.map((r) => (r.uid === rowUid ? { ...r, ...patch } : r)));

  const markPrimary = (rowUid: string) =>
    setRows((prev) =>
      prev.map((r) => ({ ...r, is_primary: !r.removed && r.uid === rowUid })),
    );

  const addRow = () => setRows((prev) => [...prev, newRow()]);

  const removeRow = (rowUid: string) => {
    setRows((prev) =>
      prev.flatMap((r) => {
        if (r.uid !== rowUid) return [r];
        // Unsaved rows can be dropped outright; saved rows are flagged for
        // deactivation and kept around so the diff includes them on save.
        if (r.id === null) return [];
        return [{ ...r, removed: true, is_primary: false }];
      }),
    );
  };

  // ── Inline category creation ──
  const submitNewCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      setNewCategoryError('Name is required');
      return;
    }
    setNewCategoryError(null);
    try {
      const created = await createCategoryM.mutateAsync({ name });
      setBasic((b) => ({ ...b, category_id: created.id }));
      setCreatingCategory(false);
      setNewCategoryName('');
    } catch (err) {
      setNewCategoryError(
        err instanceof ApiError ? err.message : 'Failed to create category',
      );
    }
  };

  // ── Validation ──
  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!basic.name.trim()) e.name = 'Name is required';
    if (!basic.category_id) e.category_id = 'Category is required';
    if (!basic.base_unit) e.base_unit = 'Base unit is required';

    const hasCPU = basic.content_per_unit.trim() !== '';
    const hasCU = basic.content_unit !== '';
    if (hasCPU !== hasCU) {
      e.content_per_unit = 'Provide both content fields or neither';
    } else if (hasCPU) {
      const n = Number(basic.content_per_unit);
      if (!Number.isFinite(n) || n <= 0) {
        e.content_per_unit = 'Must be a positive number';
      }
    }

    visibleRows.forEach((r, idx) => {
      if (!r.supplier_id) e[`row_${idx}_supplier`] = 'Pick a supplier';
      if (!r.name.trim()) e[`row_${idx}_name`] = 'Packaging name required';
      const upp = Number(r.units_per_package);
      if (!Number.isFinite(upp) || upp <= 0) {
        e[`row_${idx}_upp`] = 'Units per package must be > 0';
      }
      if (r.price_per_package.trim() !== '') {
        const price = Number(r.price_per_package);
        if (!Number.isFinite(price) || price < 0) {
          e[`row_${idx}_price`] = 'Price must be ≥ 0';
        }
      }
    });

    const primaries = visibleRows.filter((r) => r.is_primary);
    if (primaries.length > 1) {
      e.primary = 'Only one packaging can be primary';
    }

    // Initial stock validation only kicks in when the user actually entered
    // a quantity. Any non-empty value must be a positive number, paired with
    // a destination storage and at least one packaging row that has a price
    // (otherwise we'd record a purchase at unit_cost=0, polluting WAC).
    if (mode === 'create' && initialQuantity.trim() !== '') {
      const qty = Number(initialQuantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        e.initial_quantity = 'Quantity must be a positive number';
      } else {
        if (!initialStorageId) {
          e.initial_storage = 'Pick a destination storage';
        }
        if (!initialPurchasePackaging) {
          e.initial_quantity =
            'At least one packaging row needs a price for the initial purchase';
        }
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Save ──
  const performSave = async () => {
    if (!validate()) return;
    setServerError(null);

    try {
      const payload = {
        name: basic.name.trim(),
        barcode: basic.barcode.trim() || undefined,
        category_id: basic.category_id,
        base_unit: basic.base_unit as BaseUnit,
        content_per_unit: basic.content_per_unit.trim()
          ? Number(basic.content_per_unit)
          : undefined,
        content_unit: (basic.content_unit || undefined) as ContentUnit | undefined,
        active: basic.active,
      };

      let savedSupply: Supply;
      if (mode === 'edit' && supplyId) {
        savedSupply = await updateSupplyM.mutateAsync({ id: supplyId, input: payload });
      } else {
        savedSupply = await createSupplyM.mutateAsync(payload);
      }

      // Apply packaging diff. Sequential to keep error handling simple and so
      // the primary-flag exclusivity is enforced server-side row by row.
      // Track which row uid maps to which created packaging id — needed if
      // we go on to create an initial purchase against the primary row.
      const createdPackagingsByUid = new Map<string, string>();

      for (const row of rows) {
        if (row.id === null && !row.removed) {
          const created = await createPackagingM.mutateAsync({
            supply_id: savedSupply.id,
            supplier_id: row.supplier_id,
            name: row.name.trim(),
            units_per_package: Number(row.units_per_package),
            price_per_package: row.price_per_package.trim()
              ? Math.round(Number(row.price_per_package) * 100)
              : null,
            is_primary: row.is_primary,
            active: row.active,
          });
          createdPackagingsByUid.set(row.uid, created.id);
        } else if (row.id && row.removed) {
          await deletePackagingM.mutateAsync(row.id);
        } else if (row.id && rowChanged(row)) {
          await updatePackagingM.mutateAsync({
            id: row.id,
            input: {
              name: row.name.trim(),
              units_per_package: Number(row.units_per_package),
              price_per_package: row.price_per_package.trim()
                ? Math.round(Number(row.price_per_package) * 100)
                : null,
              is_primary: row.is_primary,
              active: row.active,
            },
          });
        }
      }

      // Initial purchase — only on create. Builds a one-line draft purchase
      // against the chosen packaging and immediately confirms it so WAC and
      // StorageStock land in the same save click. Quantity input is in BASE
      // units (bottles, kg, pieces); the purchase API expects packages, so
      // we divide by units_per_package — fractional values are fine, the
      // schema is Decimal.
      if (
        mode === 'create' &&
        initialQuantity.trim() !== '' &&
        initialPurchasePackaging &&
        initialStorageId
      ) {
        const pkgId = createdPackagingsByUid.get(initialPurchasePackaging.uid);
        const upp = Number(initialPurchasePackaging.units_per_package);
        const baseQty = Number(initialQuantity);
        if (pkgId && Number.isFinite(upp) && upp > 0 && Number.isFinite(baseQty) && baseQty > 0) {
          const priceCentavos = Math.round(
            Number(initialPurchasePackaging.price_per_package) * 100,
          );
          const purchase = await createPurchaseM.mutateAsync({
            supplier_id: initialPurchasePackaging.supplier_id,
            storage_id: initialStorageId,
            date: new Date().toISOString(),
            notes: 'Initial stock entered with the supply',
            items: [
              {
                supply_id: savedSupply.id,
                packaging_id: pkgId,
                package_quantity: baseQty / upp,
                price_per_package: priceCentavos,
              },
            ],
          });
          await confirmPurchaseM.mutateAsync(purchase.id);
        }
      }

      if (onSaved) {
        onSaved(savedSupply);
      } else if (mode === 'create') {
        navigate(`/inventory/supplies/${savedSupply.id}`);
      }
      // Edit mode without onSaved: stay on the page, baselines refresh from
      // the next packagings query.
      hydratedPackagingsId.current = null;
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Save failed');
    }
  };

  const handleDelete = async () => {
    if (!supplyId) return;
    try {
      await deleteSupplyM.mutateAsync(supplyId);
      navigate('/inventory/supplies');
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Delete failed');
      setConfirmingDelete(false);
    }
  };

  const pending =
    createSupplyM.isPending ||
    updateSupplyM.isPending ||
    createPackagingM.isPending ||
    updatePackagingM.isPending ||
    deletePackagingM.isPending ||
    createPurchaseM.isPending ||
    confirmPurchaseM.isPending;

  // ── Loading / not found ──
  if (mode === 'edit' && supplyQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading supply…
      </div>
    );
  }
  if (mode === 'edit' && (supplyQ.error || !supplyQ.data)) {
    return (
      <EmptyState
        icon="⚠"
        message="Supply not found"
        sub={(supplyQ.error as Error | null)?.message}
        action={
          <Link to="/inventory/supplies">
            <Button variant="secondary">Back to supplies</Button>
          </Link>
        }
      />
    );
  }

  const editingExisting = mode === 'edit' ? supplyQ.data : null;
  const headerName =
    editingExisting?.name ?? (mode === 'create' ? 'New supply' : 'Quick add supply');
  const submitLabel =
    saveLabel ?? (mode === 'edit' ? 'Save changes' : 'Create supply');

  return (
    <>
      {!embedded && (
        <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <Link
              to="/inventory/supplies"
              className="fs-12 text-muted"
              style={{ display: 'inline-block', marginBottom: 6 }}
            >
              ← Back to supplies
            </Link>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24 }}>
              {headerName}
            </h1>
            {editingExisting && (
              <div className="flex gap-8 mt-4">
                {editingExisting.active ? (
                  <Badge tone="green">Active</Badge>
                ) : (
                  <Badge tone="red">Inactive</Badge>
                )}
                {editingExisting.category && (
                  <Badge tone="gray">{editingExisting.category.name}</Badge>
                )}
                {editingExisting.barcode && (
                  <span className="fs-12 text-muted">{editingExisting.barcode}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cost / stock KPIs (edit mode only) */}
      {editingExisting && (
        <div className="section-grid-3 mb-16">
          <Card>
            <div className="chart-title">Cost</div>
            <div className="detail-grid">
              <div className="detail-row cols-2">
                <div className="detail-cell">
                  <div className="dk">Avg cost</div>
                  <div className="dv gold">
                    {formatMoney(Number(editingExisting.average_cost))}
                  </div>
                </div>
                <div className="detail-cell">
                  <div className="dk">Last cost</div>
                  <div className="dv">
                    {formatMoney(Number(editingExisting.last_cost))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="chart-title">Total stock</div>
            <div
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 32,
                fontWeight: 700,
                color: 'var(--text)',
              }}
            >
              {formatNumber(totalStock, 4)}{' '}
              <span className="fs-13 text-muted">
                {editingExisting.base_unit.toLowerCase()}
              </span>
            </div>
            <div className="fs-11 text-muted mt-4">
              Across {stocksQ.data?.items.length ?? 0} storage location(s)
            </div>
          </Card>
        </div>
      )}

      {/* Image preview from quick-add OFF lookup */}
      {prefill?.image_url && mode === 'create' && (
        <Card style={{ marginBottom: 14 }}>
          <div className="flex gap-8" style={{ alignItems: 'center' }}>
            <img
              src={prefill.image_url}
              alt=""
              style={{
                width: 96,
                height: 96,
                objectFit: 'cover',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
              }}
            />
            <div>
              {prefill.source && <Badge tone="gold">Open Food Facts</Badge>}
              {prefill.suggestedCategories && prefill.suggestedCategories.length > 0 && (
                <div className="fs-11 text-muted mt-4">
                  Suggested categories: {prefill.suggestedCategories.join(' › ')}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* SECTION 1 — Basic info */}
      <Card>
        <h3 style={{ marginBottom: 14 }}>Basic info</h3>
        <Input
          label="Name"
          name="name"
          value={basic.name}
          onChange={(e) => setField('name', e.target.value)}
          maxLength={200}
          autoFocus={mode === 'create'}
          error={errors.name}
        />
        <Input
          label="Barcode (optional)"
          name="barcode"
          value={basic.barcode}
          onChange={(e) => setField('barcode', e.target.value)}
          maxLength={64}
        />
        {creatingCategory ? (
          <div className="field">
            <label htmlFor="new_category">New category</label>
            <div className="flex gap-8">
              <input
                id="new_category"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Tea, Pastries"
                maxLength={100}
                style={{ flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submitNewCategory();
                  }
                }}
                autoFocus
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => void submitNewCategory()}
                loading={createCategoryM.isPending}
              >
                Create
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCreatingCategory(false);
                  setNewCategoryName('');
                  setNewCategoryError(null);
                }}
                disabled={createCategoryM.isPending}
              >
                Cancel
              </Button>
            </div>
            {newCategoryError && (
              <div className="field-error">{newCategoryError}</div>
            )}
          </div>
        ) : (
          <div className="field">
            <div className="flex-between" style={{ marginBottom: 4, alignItems: 'baseline' }}>
              <label htmlFor="category_id" style={{ marginBottom: 0 }}>
                Category
              </label>
              <button
                type="button"
                onClick={() => setCreatingCategory(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--gold)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                + New category
              </button>
            </div>
            <select
              id="category_id"
              name="category_id"
              value={basic.category_id}
              onChange={(e) => setField('category_id', e.target.value)}
              disabled={categoriesQ.isLoading}
            >
              <option value="">
                {categoriesQ.isLoading ? 'Loading…' : 'Select a category…'}
              </option>
              {categoriesQ.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {errors.category_id && (
              <div className="field-error">{errors.category_id}</div>
            )}
          </div>
        )}
        <div className="section-grid-2">
          <Select
            label="Base unit"
            name="base_unit"
            value={basic.base_unit}
            onValueChange={(v) => setField('base_unit', v as BaseUnit | '')}
            placeholder="Select…"
            options={BASE_UNITS.map((u) => ({ value: u, label: u }))}
            error={errors.base_unit}
          />
          <Input
            label="Content per unit"
            name="content_per_unit"
            type="number"
            step="any"
            min="0"
            value={basic.content_per_unit}
            onChange={(e) => setField('content_per_unit', e.target.value)}
            hint="e.g. 946 ml per 946ml bottle"
            error={errors.content_per_unit}
          />
        </div>
        <Select
          label="Content unit"
          name="content_unit"
          value={basic.content_unit}
          onValueChange={(v) => setField('content_unit', v as ContentUnit | '')}
          placeholder="— none —"
          options={CONTENT_UNITS.map((u) => ({ value: u, label: u }))}
        />
        <div className="field">
          <label
            htmlFor="active"
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <input
              id="active"
              type="checkbox"
              checked={basic.active}
              onChange={(e) => setField('active', e.target.checked)}
              style={{ width: 'auto', height: 'auto', cursor: 'pointer' }}
            />
            Active
          </label>
        </div>
      </Card>

      {/* SECTION 2 — Suppliers & packaging */}
      <Card style={{ marginTop: 14 }}>
        <div className="flex-between mb-8">
          <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
            Suppliers & packaging
          </h3>
          <Button variant="secondary" size="sm" onClick={addRow}>
            + Add supplier
          </Button>
        </div>
        <p className="fs-12 text-muted mb-12">
          Register one packaging row per supplier. The primary supplier is the
          default in purchase orders.
        </p>

        {suppliers.length === 0 && !suppliersQ.isLoading && (
          <EmptyState
            icon="🏭"
            message="No suppliers yet"
            sub="Create a supplier first, then come back to register this supply's packagings."
            action={
              <Link to="/inventory/suppliers">
                <Button variant="primary">Go to suppliers</Button>
              </Link>
            }
          />
        )}

        {visibleRows.length === 0 && suppliers.length > 0 && (
          <div
            style={{
              border: '1px dashed var(--border2)',
              borderRadius: 'var(--radius)',
              padding: 18,
              textAlign: 'center',
              color: 'var(--text3)',
              fontSize: 12,
            }}
          >
            No suppliers attached yet — add one to enable purchases for this supply.
          </div>
        )}

        {visibleRows.map((row, idx) => (
          <PackagingRowEditor
            key={row.uid}
            row={row}
            idx={idx}
            suppliers={suppliers}
            errors={errors}
            onChange={(patch) => updateRow(row.uid, patch)}
            onMarkPrimary={() => markPrimary(row.uid)}
            onRemove={() => removeRow(row.uid)}
          />
        ))}

        {errors.primary && <div className="field-error">{errors.primary}</div>}
      </Card>

      {/* Initial stock — only meaningful when registering a brand-new supply.
          In edit mode you adjust stock through Purchase Orders / Transfers /
          Inventory Checks instead. */}
      {mode === 'create' && (
        <Card style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 6 }}>Initial stock (optional)</h3>
          <p className="fs-12 text-muted mb-12">
            Skip this if you're just cataloguing the supply. Filled in, it
            creates a confirmed purchase against the primary packaging so the
            supply lands with real stock and a real average cost in one click.
          </p>

          <div className="section-grid-2">
            {fixedStorageId ? (
              <div className="field">
                <label>Destination storage</label>
                <div
                  className="fs-13 fw-600"
                  style={{
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg)',
                    color: 'var(--text2)',
                  }}
                >
                  {storages.find((s) => s.id === fixedStorageId)?.name ?? '—'}
                </div>
                <div className="fs-11 text-muted mt-4">
                  Locked to the storage picked at the top of Quick Add.
                </div>
              </div>
            ) : (
              <Select
                label="Destination storage"
                name="initial_storage_id"
                value={initialStorageId}
                onValueChange={setInitialStorageId}
                placeholder={
                  storagesQ.isLoading ? 'Loading…' : 'Pick a storage…'
                }
                options={storages.map((s) => ({ value: s.id, label: s.name }))}
                error={errors.initial_storage}
                disabled={storagesQ.isLoading}
              />
            )}

            <Input
              label={`Quantity (in ${(basic.base_unit || 'base unit').toLowerCase()})`}
              name="initial_quantity"
              type="number"
              step="any"
              min="0"
              value={initialQuantity}
              onChange={(e) => setInitialQuantity(e.target.value)}
              placeholder="e.g. 24"
              hint={
                initialQuantity.trim() === ''
                  ? 'Leave blank to register the supply with zero stock'
                  : initialPurchasePackaging
                    ? `Records a purchase from ${
                        suppliers.find(
                          (s) => s.id === initialPurchasePackaging.supplier_id,
                        )?.name ?? 'the chosen supplier'
                      } using "${initialPurchasePackaging.name || 'primary packaging'}"`
                    : 'Add a packaging row above with a price first'
              }
              error={errors.initial_quantity}
            />
          </div>
        </Card>
      )}

      {/* SECTION 3 — Stock by storage (edit mode, read-only) */}
      {editingExisting && (
        <ReadonlyStockSection
          baseUnit={editingExisting.base_unit}
          stocks={stocksQ.data?.items ?? []}
          loading={stocksQ.isLoading}
          error={stocksQ.error as Error | null}
        />
      )}

      {/* SECTION 4 — Tare weight (read-only when set) */}
      {editingExisting?.tare_weight && (
        <ReadonlyTareSection
          tare={editingExisting.tare_weight}
          contentUnit={editingExisting.content_unit}
        />
      )}

      {/* SECTION 5 — Recent movements (edit mode, read-only) */}
      {editingExisting && (
        <ReadonlyMovementsSection
          supplyId={editingExisting.id}
          movements={movements}
          loading={movementsQ.isLoading}
          error={movementsQ.error as Error | null}
        />
      )}

      {/* Footer actions */}
      {serverError && (
        <div className="auth-alert" style={{ marginTop: 16 }}>
          {serverError}
        </div>
      )}

      <div
        className="flex-between"
        style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}
      >
        <div className="flex gap-8">
          {!embedded && (
            <Button
              variant="ghost"
              onClick={() => navigate('/inventory/supplies')}
              disabled={pending}
            >
              Cancel
            </Button>
          )}
          {editingExisting && (
            confirmingDelete ? (
              <>
                <span className="fs-12 text-red" style={{ alignSelf: 'center' }}>
                  Delete this supply?
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDelete}
                  loading={deleteSupplyM.isPending}
                >
                  Yes, delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleteSupplyM.isPending}
                >
                  Keep it
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending}
                style={{ color: 'var(--red)' }}
              >
                Delete supply
              </Button>
            )
          )}
        </div>
        <Button variant="primary" onClick={performSave} loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components (kept in this file because they're only used here)
// ────────────────────────────────────────────────────────────────────────────

interface RowEditorProps {
  row: PackagingRow;
  idx: number;
  suppliers: { id: string; name: string }[];
  errors: Record<string, string>;
  onChange: (patch: Partial<PackagingRow>) => void;
  onMarkPrimary: () => void;
  onRemove: () => void;
}

function PackagingRowEditor({
  row,
  idx,
  suppliers,
  errors,
  onChange,
  onMarkPrimary,
  onRemove,
}: RowEditorProps) {
  const upp = Number(row.units_per_package);
  const priceCents = row.price_per_package.trim()
    ? Math.round(Number(row.price_per_package) * 100)
    : null;
  const unitCost =
    priceCents !== null && Number.isFinite(upp) && upp > 0
      ? priceCents / upp
      : null;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 14,
        marginBottom: 12,
        background: 'var(--bg)',
      }}
    >
      <div className="flex-between mb-8" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label
          className="flex gap-8"
          style={{ alignItems: 'center', cursor: 'pointer' }}
        >
          <input
            type="radio"
            name="primary_packaging"
            checked={row.is_primary}
            onChange={onMarkPrimary}
            style={{ width: 'auto', height: 'auto', cursor: 'pointer' }}
          />
          <span className="fw-600 fs-13">
            {row.is_primary ? 'Primary supplier' : 'Make primary'}
          </span>
        </label>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          {row.id ? 'Deactivate' : 'Remove'}
        </Button>
      </div>

      <div className="section-grid-2">
        <Select
          label="Supplier"
          name={`row_${idx}_supplier`}
          value={row.supplier_id}
          onValueChange={(v) => onChange({ supplier_id: v })}
          placeholder="Select supplier…"
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          error={errors[`row_${idx}_supplier`]}
          disabled={row.supplier_locked || row.id !== null}
        />
        <Input
          label="Packaging name"
          name={`row_${idx}_name`}
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Box of 6, Bottle 1L, …"
          maxLength={200}
          error={errors[`row_${idx}_name`]}
        />
      </div>

      <div className="section-grid-2">
        <Input
          label="Units per package"
          name={`row_${idx}_upp`}
          type="number"
          step="any"
          min="0"
          value={row.units_per_package}
          onChange={(e) => onChange({ units_per_package: e.target.value })}
          hint="1 if you buy them individually"
          error={errors[`row_${idx}_upp`]}
        />
        <Input
          label="Price per package"
          name={`row_${idx}_price`}
          type="number"
          step="0.01"
          min="0"
          value={row.price_per_package}
          onChange={(e) => onChange({ price_per_package: e.target.value })}
          hint={
            unitCost !== null
              ? `Unit cost ≈ ${formatMoney(unitCost)}`
              : 'Optional but recommended'
          }
          error={errors[`row_${idx}_price`]}
        />
      </div>

      {row.id && !row.active && (
        <div className="fs-11 text-muted mt-4">
          Currently inactive — re-enable below to surface in purchase orders.
        </div>
      )}

      {row.id && (
        <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
          <label
            className="flex gap-8"
            style={{ alignItems: 'center', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={row.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              style={{ width: 'auto', height: 'auto', cursor: 'pointer' }}
            />
            <span className="fs-13">Active</span>
          </label>
        </div>
      )}
    </div>
  );
}

interface StockSectionProps {
  baseUnit: BaseUnit;
  stocks: StorageStock[];
  loading: boolean;
  error: Error | null;
}

function ReadonlyStockSection({ baseUnit, stocks, loading, error }: StockSectionProps) {
  const cols: TableColumn<StorageStock>[] = [
    {
      key: 'storage',
      header: 'Storage',
      width: '2fr',
      render: (s) => <div className="fw-600 fs-13">{s.storage?.name ?? '—'}</div>,
    },
    {
      key: 'qty',
      header: `Quantity (${baseUnit.toLowerCase()})`,
      width: '1fr',
      render: (s) => <span className="fw-600 fs-13">{formatNumber(s.quantity)}</span>,
    },
    {
      key: 'min',
      header: 'Min stock',
      width: '1fr',
      render: (s) => (
        <span className="text-muted fs-12">
          {s.min_stock ? formatNumber(s.min_stock) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (s) => {
        const qty = Number(s.quantity);
        const min = s.min_stock ? Number(s.min_stock) : null;
        if (min !== null && qty <= min) return <Badge tone="red">Below min</Badge>;
        if (min !== null && qty <= min * 1.5) return <Badge tone="gold">Low</Badge>;
        return <Badge tone="green">OK</Badge>;
      },
    },
  ];
  return (
    <SectionWrap title="Stock by storage">
      <Table
        columns={cols}
        rows={stocks}
        getRowKey={(s) => s.id}
        isInitialLoad={loading}
        error={error}
        emptyMessage="No stock recorded yet"
        emptySub="Stock is created when the first purchase is confirmed."
      />
    </SectionWrap>
  );
}

interface TareSectionProps {
  tare: NonNullable<Supply['tare_weight']>;
  contentUnit: ContentUnit | null;
}

function ReadonlyTareSection({ tare, contentUnit }: TareSectionProps) {
  return (
    <SectionWrap title="Tare weight">
      <div className="detail-grid">
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Empty weight</div>
            <div className="dv">{formatNumber(tare.empty_weight_grams)} g</div>
          </div>
          <div className="detail-cell">
            <div className="dk">Full weight</div>
            <div className="dv">{formatNumber(tare.full_weight_grams)} g</div>
          </div>
        </div>
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Net content</div>
            <div className="dv gold">
              {formatNumber(tare.net_content)} {contentUnit?.toLowerCase() ?? ''}
            </div>
          </div>
          <div className="detail-cell">
            <div className="dk">Formula</div>
            <div className="dv fs-12 text-muted">
              remaining = (current − empty) / (full − empty) × net
            </div>
          </div>
        </div>
      </div>
    </SectionWrap>
  );
}

interface MovementsSectionProps {
  supplyId: string;
  movements: StockMovement[];
  loading: boolean;
  error: Error | null;
}

function ReadonlyMovementsSection({
  supplyId,
  movements,
  loading,
  error,
}: MovementsSectionProps) {
  const cols: TableColumn<StockMovement>[] = [
    {
      key: 'date',
      header: 'Date',
      width: '170px',
      render: (m) => (
        <span className="fs-12 text-muted">{formatDateTime(m.created_at)}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '130px',
      render: (m) => <Badge tone={movementTypeTone(m.type)}>{m.type}</Badge>,
    },
    {
      key: 'storage',
      header: 'Storage',
      width: '1fr',
      render: (m) => <span className="fs-13">{m.storage?.name ?? '—'}</span>,
    },
    {
      key: 'qty',
      header: 'Qty',
      width: '110px',
      render: (m) => {
        const qty = Number(m.quantity);
        const cls = qty < 0 ? 'text-red' : 'text-green';
        const sign = qty > 0 ? '+' : '';
        return (
          <span className={`fw-600 fs-13 ${cls}`}>
            {sign}
            {formatNumber(qty, 4)}
          </span>
        );
      },
    },
    {
      key: 'cost',
      header: 'Unit cost',
      width: '110px',
      render: (m) => (
        <span className="fs-12 text-muted">{formatMoney(Number(m.unit_cost))}</span>
      ),
    },
  ];
  return (
    <SectionWrap
      title="Recent movements"
      headerExtra={
        <Link
          to={`/inventory/movements?supply_id=${supplyId}`}
          className="fs-12 text-gold"
        >
          View all →
        </Link>
      }
    >
      <Table
        columns={cols}
        rows={movements.slice(0, 20)}
        getRowKey={(m) => m.id}
        isInitialLoad={loading}
        error={error}
        emptyMessage="No movements yet"
      />
    </SectionWrap>
  );
}

function SectionWrap({
  title,
  headerExtra,
  children,
}: {
  title: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="flex-between mb-8">
        <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>{title}</h3>
        {headerExtra}
      </div>
      {children}
    </div>
  );
}
