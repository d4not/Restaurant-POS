import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import { useSupplyCategories } from '../../hooks/useSupplyCategories';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useCreateSupply } from '../../hooks/useSupplies';
import { useCreatePackaging } from '../../hooks/usePackagings';
import { formatMoney, formatNumber } from '../../utils/format';
import {
  BASE_UNITS,
  CONTENT_UNITS,
  type BaseUnit,
  type ContentUnit,
} from '../../types/inventory';

// The multi-step supply creation flow.
//
// Step 1 — Basic info          (name, barcode, category, unit model)
// Step 2 — Suppliers & pricing (one or more packaging rows, exactly one primary)
// Step 3 — Review & save       (summary + "Create supply")
//
// On save we POST /supplies first, then POST /packagings for each supplier row
// using the new supply's id. Any packaging failure is surfaced with a link to
// the freshly-created supply so the user can retry without recreating it.

type Step = 1 | 2 | 3;

interface BasicState {
  name: string;
  barcode: string;
  category_id: string;
  base_unit: BaseUnit | '';
  content_per_unit: string;
  content_unit: ContentUnit | '';
}

interface SupplierRow {
  // Unique client id; not sent to the backend.
  uid: string;
  supplier_id: string;
  name: string;
  units_per_package: string;
  price_per_package: string;
  is_primary: boolean;
}

const EMPTY_BASIC: BasicState = {
  name: '',
  barcode: '',
  category_id: '',
  base_unit: '',
  content_per_unit: '',
  content_unit: '',
};

function emptyRow(primary = false): SupplierRow {
  return {
    uid: crypto.randomUUID(),
    supplier_id: '',
    name: '',
    units_per_package: '',
    price_per_package: '',
    is_primary: primary,
  };
}

export function SupplyCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [basic, setBasic] = useState<BasicState>(EMPTY_BASIC);
  const [rows, setRows] = useState<SupplierRow[]>([emptyRow(true)]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const categoriesQ = useSupplyCategories();
  const suppliersQ = useSuppliers({ active: true });
  const createSupplyM = useCreateSupply();
  const createPackagingM = useCreatePackaging();

  const suppliers = useMemo(
    () => suppliersQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliersQ.data],
  );
  const supplierById = useMemo(() => {
    const map = new Map<string, string>();
    suppliers.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [suppliers]);
  const categoryName = useMemo(
    () => categoriesQ.data?.items.find((c) => c.id === basic.category_id)?.name ?? '—',
    [categoriesQ.data, basic.category_id],
  );

  const setField = <K extends keyof BasicState>(key: K, value: BasicState[K]) => {
    setBasic((b) => ({ ...b, [key]: value }));
  };

  const setRow = (uid: string, patch: Partial<SupplierRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    );
  };

  const markPrimary = (uid: string) => {
    setRows((prev) => prev.map((r) => ({ ...r, is_primary: r.uid === uid })));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow(prev.length === 0)]);

  const removeRow = (uid: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.uid !== uid);
      // Guarantee one row is primary — if the removed row held the flag,
      // promote the first remaining row.
      if (next.length > 0 && !next.some((r) => r.is_primary)) {
        next[0] = { ...next[0], is_primary: true };
      }
      return next;
    });
  };

  // ── Validation ──
  const validateStep1 = (): boolean => {
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
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = (): boolean => {
    const e: Record<string, string> = {};
    if (rows.length === 0) {
      e.rows = 'Add at least one supplier, or skip this step with the button above';
    }
    rows.forEach((r, idx) => {
      if (!r.supplier_id) e[`row_${idx}_supplier`] = 'Select a supplier';
      if (!r.name.trim()) e[`row_${idx}_name`] = 'Packaging name required';
      const upp = Number(r.units_per_package);
      if (!Number.isFinite(upp) || upp <= 0) {
        e[`row_${idx}_upp`] = 'Units per package must be > 0';
      }
      if (r.price_per_package.trim() !== '') {
        const price = Number(r.price_per_package);
        if (!Number.isFinite(price) || price < 0) {
          e[`row_${idx}_price`] = 'Price must be a non-negative number';
        }
      }
    });
    if (rows.length > 0 && !rows.some((r) => r.is_primary)) {
      e.primary = 'Mark exactly one supplier as primary';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Step navigation ──
  const goNext = () => {
    setServerError(null);
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && rows.length > 0 && !validateStep2()) return;
    setStep((s) => (s === 3 ? 3 : ((s + 1) as Step)));
  };

  const goBack = () => {
    setServerError(null);
    setErrors({});
    setStep((s) => (s === 1 ? 1 : ((s - 1) as Step)));
  };

  const skipSuppliers = () => {
    setRows([]);
    setErrors({});
    setStep(3);
  };

  // ── Final save ──
  const save = async () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    if (rows.length > 0 && !validateStep2()) {
      setStep(2);
      return;
    }
    setServerError(null);

    try {
      const supply = await createSupplyM.mutateAsync({
        name: basic.name.trim(),
        barcode: basic.barcode.trim() || undefined,
        category_id: basic.category_id,
        base_unit: basic.base_unit as BaseUnit,
        content_per_unit: basic.content_per_unit.trim()
          ? Number(basic.content_per_unit)
          : undefined,
        content_unit: (basic.content_unit || undefined) as ContentUnit | undefined,
        active: true,
      });

      // Create packagings sequentially — it keeps error handling simple and
      // the primary-flag exclusivity is enforced server-side on each write.
      for (const row of rows) {
        await createPackagingM.mutateAsync({
          supply_id: supply.id,
          supplier_id: row.supplier_id,
          name: row.name.trim(),
          units_per_package: Number(row.units_per_package),
          price_per_package: row.price_per_package.trim()
            ? Math.round(Number(row.price_per_package) * 100)
            : null,
          is_primary: row.is_primary,
          active: true,
        });
      }

      navigate(`/inventory/supplies/${supply.id}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const pending = createSupplyM.isPending || createPackagingM.isPending;

  return (
    <>
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
            New supply
          </h1>
        </div>
      </div>

      <Stepper step={step} />

      {serverError && (
        <div className="auth-alert mb-16">{serverError}</div>
      )}

      {step === 1 && (
        <Card>
          <h3 style={{ marginBottom: 14 }}>Basic info</h3>
          <Input
            label="Name"
            name="name"
            value={basic.name}
            onChange={(e) => setField('name', e.target.value)}
            autoFocus
            maxLength={200}
            error={errors.name}
          />
          <Input
            label="Barcode (optional)"
            name="barcode"
            value={basic.barcode}
            onChange={(e) => setField('barcode', e.target.value)}
            maxLength={64}
          />
          <Select
            label="Category"
            name="category_id"
            value={basic.category_id}
            onValueChange={(v) => setField('category_id', v)}
            placeholder={categoriesQ.isLoading ? 'Loading…' : 'Select a category…'}
            options={
              categoriesQ.data?.items.map((c) => ({ value: c.id, label: c.name })) ?? []
            }
            error={errors.category_id}
            disabled={categoriesQ.isLoading}
          />
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

          <div className="flex-between mt-16">
            <Link to="/inventory/supplies">
              <Button variant="ghost">Cancel</Button>
            </Link>
            <Button variant="primary" onClick={goNext}>
              Next: Suppliers →
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <div className="flex-between mb-8">
            <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
              Suppliers & packaging
            </h3>
            <Button variant="secondary" size="sm" onClick={addRow}>
              + Add supplier
            </Button>
          </div>
          <p className="fs-12 text-muted mb-12">
            Register one packaging per supplier. The primary supplier is the
            default option when creating a purchase order.
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

          {rows.length === 0 && suppliers.length > 0 && (
            <EmptyState
              icon="📦"
              message="No suppliers configured"
              sub="Add at least one, or skip this step and add suppliers from the supply detail page later."
              action={
                <Button variant="secondary" onClick={addRow}>
                  + Add supplier
                </Button>
              }
            />
          )}

          {rows.map((row, idx) => (
            <SupplierRowEditor
              key={row.uid}
              row={row}
              idx={idx}
              suppliers={suppliers}
              errors={errors}
              onChange={(patch) => setRow(row.uid, patch)}
              onMarkPrimary={() => markPrimary(row.uid)}
              onRemove={() => removeRow(row.uid)}
              canRemove={rows.length > 1}
            />
          ))}

          {errors.primary && <div className="field-error">{errors.primary}</div>}
          {errors.rows && <div className="field-error">{errors.rows}</div>}

          <div className="flex-between mt-16" style={{ flexWrap: 'wrap', gap: 8 }}>
            <Button variant="ghost" onClick={goBack}>
              ← Back
            </Button>
            <div className="flex gap-8">
              <Button variant="secondary" onClick={skipSuppliers}>
                Skip suppliers
              </Button>
              <Button variant="primary" onClick={goNext}>
                Next: Review →
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <h3 style={{ marginBottom: 14 }}>Review</h3>

          <div className="detail-grid mb-16">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Name</div>
                <div className="dv fw-600">{basic.name || '—'}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Barcode</div>
                <div className="dv">{basic.barcode || '—'}</div>
              </div>
            </div>
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Category</div>
                <div className="dv">{categoryName}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Base unit</div>
                <div className="dv">{basic.base_unit || '—'}</div>
              </div>
            </div>
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Content</div>
                <div className="dv">
                  {basic.content_per_unit && basic.content_unit
                    ? `${formatNumber(basic.content_per_unit)} ${basic.content_unit.toLowerCase()}`
                    : '—'}
                </div>
              </div>
              <div className="detail-cell">
                <div className="dk">Suppliers</div>
                <div className="dv">
                  {rows.length === 0 ? 'None — can be added later' : `${rows.length} registered`}
                </div>
              </div>
            </div>
          </div>

          {rows.length > 0 && (
            <>
              <h3 style={{ marginBottom: 8 }}>Supplier packaging</h3>
              <div className="table-wrap">
                <div
                  className="table-head"
                  style={{
                    gridTemplateColumns: '1.3fr 1.3fr 120px 120px 120px 90px',
                  }}
                >
                  <div>Supplier</div>
                  <div>Packaging</div>
                  <div>Units / pkg</div>
                  <div>Price / pkg</div>
                  <div>Unit cost</div>
                  <div>Primary</div>
                </div>
                {rows.map((r, idx) => {
                  const upp = Number(r.units_per_package);
                  const price = r.price_per_package.trim()
                    ? Math.round(Number(r.price_per_package) * 100)
                    : null;
                  const unitCost =
                    price !== null && upp > 0 ? price / upp : null;
                  return (
                    <div
                      key={r.uid}
                      className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
                      style={{
                        gridTemplateColumns:
                          '1.3fr 1.3fr 120px 120px 120px 90px',
                      }}
                    >
                      <div className="fs-13 fw-600">
                        {supplierById.get(r.supplier_id) ?? '—'}
                      </div>
                      <div className="fs-13">{r.name || '—'}</div>
                      <div className="fs-13">
                        {Number.isFinite(upp) && upp > 0
                          ? formatNumber(upp, 4)
                          : '—'}
                      </div>
                      <div className="fs-13">
                        {price !== null ? formatMoney(price) : '—'}
                      </div>
                      <div className="fs-13 text-gold fw-600">
                        {unitCost !== null ? formatMoney(unitCost) : '—'}
                      </div>
                      <div>
                        {r.is_primary ? (
                          <Badge tone="gold">Primary</Badge>
                        ) : (
                          <span className="text-muted fs-12">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex-between mt-16">
            <Button variant="ghost" onClick={goBack} disabled={pending}>
              ← Back
            </Button>
            <Button variant="primary" onClick={save} loading={pending}>
              Create supply
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

// ── Stepper ──

function Stepper({ step }: { step: Step }) {
  const items: { n: Step; label: string }[] = [
    { n: 1, label: 'Basic info' },
    { n: 2, label: 'Suppliers' },
    { n: 3, label: 'Review' },
  ];
  return (
    <div className="stepper mb-16">
      {items.map((it, idx) => (
        <div key={it.n} className="stepper-item">
          <div
            className={`stepper-dot ${
              step === it.n ? 'active' : step > it.n ? 'done' : ''
            }`}
          >
            {step > it.n ? '✓' : it.n}
          </div>
          <div
            className={`stepper-label ${step === it.n ? 'active' : ''}`}
          >
            {it.label}
          </div>
          {idx < items.length - 1 && <div className="stepper-line" />}
        </div>
      ))}
    </div>
  );
}

// ── Supplier row ──

interface SupplierRowEditorProps {
  row: SupplierRow;
  idx: number;
  suppliers: { id: string; name: string }[];
  errors: Record<string, string>;
  onChange: (patch: Partial<SupplierRow>) => void;
  onMarkPrimary: () => void;
  onRemove: () => void;
  canRemove: boolean;
}

function SupplierRowEditor({
  row,
  idx,
  suppliers,
  errors,
  onChange,
  onMarkPrimary,
  onRemove,
  canRemove,
}: SupplierRowEditorProps) {
  const upp = Number(row.units_per_package);
  const price = row.price_per_package.trim()
    ? Math.round(Number(row.price_per_package) * 100)
    : null;
  const unitCost = price !== null && upp > 0 ? price / upp : null;

  return (
    <div
      className="supplier-row"
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
            name="primary_supplier"
            checked={row.is_primary}
            onChange={onMarkPrimary}
            style={{ width: 'auto', height: 'auto', cursor: 'pointer' }}
          />
          <span className="fw-600 fs-13">
            {row.is_primary ? 'Primary supplier' : 'Secondary'}
          </span>
        </label>
        {canRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      <div className="section-grid-2">
        <Select
          label="Supplier"
          name={`supplier_${idx}`}
          value={row.supplier_id}
          onValueChange={(v) => onChange({ supplier_id: v })}
          placeholder="Select supplier…"
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          error={errors[`row_${idx}_supplier`]}
        />
        <Input
          label="Packaging name"
          name={`pkg_name_${idx}`}
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Box of 6 bottles"
          maxLength={200}
          error={errors[`row_${idx}_name`]}
        />
      </div>

      <div className="section-grid-2">
        <Input
          label="Units per package"
          name={`upp_${idx}`}
          type="number"
          step="any"
          min="0"
          value={row.units_per_package}
          onChange={(e) => onChange({ units_per_package: e.target.value })}
          hint="e.g. 6 — how many base units per package"
          error={errors[`row_${idx}_upp`]}
        />
        <Input
          label="Price per package (optional)"
          name={`price_${idx}`}
          type="number"
          step="0.01"
          min="0"
          value={row.price_per_package}
          onChange={(e) => onChange({ price_per_package: e.target.value })}
          hint={
            unitCost !== null
              ? `Unit cost ≈ ${formatMoney(unitCost)}`
              : 'Sets the default price in purchase orders'
          }
          error={errors[`row_${idx}_price`]}
        />
      </div>
    </div>
  );
}
