import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useStorages } from '../../hooks/useStorages';
import { useSupplies } from '../../hooks/useSupplies';
import { listPackagings } from '../../api/packagings';
import { useCreatePurchase } from '../../hooks/usePurchases';
import { formatMoney } from '../../utils/format';
import { uid } from '../../utils/uid';
import { useTranslation } from '../../i18n';
import type { PurchaseKind, PurchasePackaging } from '../../types/inventory';
import { KIND_ICON } from '../../components/purchase-orders/status';

// A single draft line the user is building.
interface DraftLine {
  uid: string;
  supply_id: string;
  packaging_id: string | null;
  package_quantity: string;
  price_per_package: string;
  // Packagings available for this supply+supplier, fetched lazily when the
  // supply is selected.
  packagings: PurchasePackaging[];
  loadingPackagings: boolean;
}

function newLine(): DraftLine {
  return {
    uid: uid(),
    supply_id: '',
    packaging_id: null,
    package_quantity: '1',
    price_per_package: '',
    packagings: [],
    loadingPackagings: false,
  };
}

function lineTotalCentavos(line: DraftLine): number {
  const qty = Number(line.package_quantity);
  const price = Number(line.price_per_package);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
  return Math.round(qty * price * 100);
}

export function PurchaseOrderCreate() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  // ?kind=DELIVERY|ERRAND drives the supplier dropdown filter + header copy.
  // Default DELIVERY since that's the structured flow.
  const kind: PurchaseKind =
    searchParams.get('kind') === 'ERRAND' ? 'ERRAND' : 'DELIVERY';
  const [supplierId, setSupplierId] = useState('');
  const [storageId, setStorageId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const suppliersQ = useSuppliers({ active: true });
  const storagesQ = useStorages();
  const suppliesQ = useSupplies({ active: true });
  const createPurchaseM = useCreatePurchase();

  const suppliers = useMemo(() => {
    const all = suppliersQ.data?.pages.flatMap((p) => p.items) ?? [];
    // Filter to suppliers compatible with the selected kind. BOTH matches
    // both flows. This prevents the operator from picking a DELIVERY-only
    // supplier for an errand and getting a backend 400.
    return all.filter((s) => s.kind === 'BOTH' || s.kind === kind);
  }, [suppliersQ.data, kind]);
  const supplies = useMemo(
    () => suppliesQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliesQ.data],
  );
  const storages = storagesQ.data?.items ?? [];

  const runningTotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineTotalCentavos(line), 0),
    [lines],
  );

  const setLine = (uid: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  };

  const removeLine = (uid: string) => {
    setLines((prev) =>
      prev.length === 1 ? [newLine()] : prev.filter((l) => l.uid !== uid),
    );
  };

  const addLine = () => setLines((prev) => [...prev, newLine()]);

  // When the user picks a supply, fetch packagings scoped to the current
  // supplier + supply combo and auto-fill the primary one with its price.
  const onPickSupply = async (line: DraftLine, supplyId: string) => {
    if (!supplyId) {
      setLine(line.uid, {
        supply_id: '',
        packaging_id: null,
        price_per_package: '',
        packagings: [],
      });
      return;
    }
    setLine(line.uid, {
      supply_id: supplyId,
      loadingPackagings: true,
      packagings: [],
      packaging_id: null,
      price_per_package: '',
    });
    try {
      const page = await listPackagings({
        supply_id: supplyId,
        supplier_id: supplierId || undefined,
        active: true,
        limit: 100,
      });
      const primary = page.items.find((p) => p.is_primary) ?? page.items[0];
      setLine(line.uid, {
        packagings: page.items,
        loadingPackagings: false,
        packaging_id: primary?.id ?? null,
        price_per_package:
          primary?.price_per_package != null
            ? (Number(primary.price_per_package) / 100).toString()
            : '',
      });
    } catch {
      setLine(line.uid, { loadingPackagings: false });
    }
  };

  // Switching packagings on the same line should refresh the price from the
  // new packaging's last known value.
  const onPickPackaging = (line: DraftLine, packagingId: string) => {
    const pkg = line.packagings.find((p) => p.id === packagingId);
    setLine(line.uid, {
      packaging_id: packagingId || null,
      price_per_package:
        pkg?.price_per_package != null
          ? (Number(pkg.price_per_package) / 100).toString()
          : line.price_per_package,
    });
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!supplierId) e.supplier_id = 'Supplier is required';
    if (!storageId) e.storage_id = 'Receiving storage is required';
    if (!date) e.date = 'Date is required';
    const validLines = lines.filter((l) => l.supply_id);
    if (validLines.length === 0) {
      e.lines = 'Add at least one supply line';
    }
    validLines.forEach((line, idx) => {
      const qty = Number(line.package_quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        e[`line_${idx}_qty`] = 'Quantity must be > 0';
      }
      const price = Number(line.price_per_package);
      if (!Number.isFinite(price) || price < 0) {
        e[`line_${idx}_price`] = 'Price must be ≥ 0';
      }
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setServerError(null);

    try {
      const purchase = await createPurchaseM.mutateAsync({
        supplier_id: supplierId,
        storage_id: storageId,
        date: new Date(`${date}T12:00:00`).toISOString(),
        kind,
        payment_method: paymentMethod.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines
          .filter((l) => l.supply_id)
          .map((l) => ({
            supply_id: l.supply_id,
            packaging_id: l.packaging_id || null,
            package_quantity: Number(l.package_quantity),
            price_per_package: Math.round(Number(l.price_per_package) * 100),
          })),
      });
      navigate(`/inventory/purchases/${purchase.id}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const clearLines = () => {
    // When the supplier changes, the packaging options on existing lines are
    // no longer valid — reset the supply selections to start fresh.
    setLines([newLine()]);
  };

  return (
    <>
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Link
            to="/inventory/purchases"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← Back to purchase orders
          </Link>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24 }}>
            <span aria-hidden style={{ marginRight: 8 }}>{KIND_ICON[kind]}</span>
            {kind === 'DELIVERY' ? t('po.newDelivery') : t('po.newErrand')}
          </h1>
        </div>
      </div>

      {serverError && <div className="auth-alert mb-16">{serverError}</div>}

      <Card>
        <h3 style={{ marginBottom: 14 }}>Header</h3>
        <div className="section-grid-2">
          <Select
            label="Supplier"
            name="supplier_id"
            value={supplierId}
            onValueChange={(v) => {
              setSupplierId(v);
              clearLines();
            }}
            placeholder={suppliersQ.isLoading ? 'Loading…' : 'Select supplier…'}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            error={errors.supplier_id}
          />
          <Select
            label="Receiving storage"
            name="storage_id"
            value={storageId}
            onValueChange={setStorageId}
            placeholder="Select storage…"
            options={storages
              .filter((s) => s.active)
              .map((s) => ({ value: s.id, label: s.name }))}
            error={errors.storage_id}
          />
        </div>
        <div className="section-grid-2">
          <Input
            label="Date"
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={errors.date}
          />
          <Input
            label="Payment method (optional)"
            name="payment_method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            placeholder="Cash, transfer, 30-day credit…"
            maxLength={64}
          />
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            placeholder="Reference code, invoice number, etc."
          />
        </div>
      </Card>

      <div style={{ height: 16 }} />

      <Card>
        <div className="flex-between mb-8">
          <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
            Lines
          </h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={addLine}
            disabled={!supplierId}
          >
            + Add line
          </Button>
        </div>

        {!supplierId && (
          <EmptyState
            icon="👆"
            message="Pick a supplier first"
            sub="The available packaging for each supply depends on the selected supplier."
          />
        )}

        {supplierId &&
          lines.map((line, idx) => (
            <LineEditor
              key={line.uid}
              line={line}
              idx={idx}
              supplies={supplies}
              errors={errors}
              onChange={(patch) => setLine(line.uid, patch)}
              onPickSupply={(id) => onPickSupply(line, id)}
              onPickPackaging={(id) => onPickPackaging(line, id)}
              onRemove={() => removeLine(line.uid)}
            />
          ))}

        {errors.lines && <div className="field-error">{errors.lines}</div>}

        {supplierId && (
          <div
            className="flex-between mt-16"
            style={{
              padding: '12px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
            }}
          >
            <span className="fs-13 text-muted">Running total</span>
            <span
              className="fw-700"
              style={{ fontFamily: "'Playfair Display', serif", fontSize: 20 }}
            >
              {formatMoney(runningTotal)}
            </span>
          </div>
        )}

        <div className="flex-between mt-16" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Link to="/inventory/purchases">
            <Button variant="ghost">Cancel</Button>
          </Link>
          <Button
            variant="primary"
            onClick={save}
            loading={createPurchaseM.isPending}
            disabled={!supplierId || !storageId}
          >
            Save as draft
          </Button>
        </div>
      </Card>
    </>
  );
}

interface LineEditorProps {
  line: DraftLine;
  idx: number;
  supplies: { id: string; name: string; base_unit: string }[];
  errors: Record<string, string>;
  onChange: (patch: Partial<DraftLine>) => void;
  onPickSupply: (id: string) => void;
  onPickPackaging: (id: string) => void;
  onRemove: () => void;
}

function LineEditor({
  line,
  idx,
  supplies,
  errors,
  onChange,
  onPickSupply,
  onPickPackaging,
  onRemove,
}: LineEditorProps) {
  const selectedPkg = line.packagings.find((p) => p.id === line.packaging_id);
  const qty = Number(line.package_quantity);
  const baseUnits =
    selectedPkg && Number.isFinite(qty) ? qty * Number(selectedPkg.units_per_package) : null;
  const lineTotal = lineTotalCentavos(line);

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
      <div className="flex-between mb-8">
        <span className="fs-12 fw-600 text-muted">LINE {idx + 1}</span>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>

      <div className="section-grid-2">
        <Select
          label="Supply"
          name={`supply_${idx}`}
          value={line.supply_id}
          onValueChange={(v) => onPickSupply(v)}
          placeholder="Select supply…"
          options={supplies.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          label="Packaging"
          name={`packaging_${idx}`}
          value={line.packaging_id ?? ''}
          onValueChange={(v) => onPickPackaging(v)}
          placeholder={
            line.loadingPackagings
              ? 'Loading…'
              : line.packagings.length === 0
                ? 'No packaging — bought in base units'
                : 'Select packaging…'
          }
          options={line.packagings.map((p) => ({
            value: p.id,
            label: `${p.name}${p.is_primary ? ' ★' : ''} (${Number(p.units_per_package)} per pkg)`,
          }))}
          disabled={line.loadingPackagings || !line.supply_id}
        />
      </div>

      <div className="section-grid-2">
        <Input
          label="Packages"
          name={`qty_${idx}`}
          type="number"
          step="any"
          min="0"
          value={line.package_quantity}
          onChange={(e) => onChange({ package_quantity: e.target.value })}
          hint={
            baseUnits !== null
              ? `≈ ${baseUnits.toFixed(4)} base units`
              : undefined
          }
          error={errors[`line_${idx}_qty`]}
        />
        <Input
          label="Price per package"
          name={`price_${idx}`}
          type="number"
          step="0.01"
          min="0"
          value={line.price_per_package}
          onChange={(e) => onChange({ price_per_package: e.target.value })}
          hint={`Line total: ${formatMoney(lineTotal)}`}
          error={errors[`line_${idx}_price`]}
        />
      </div>
    </div>
  );
}
