import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import { useSuppliers } from '../../hooks/useSuppliers';
import {
  useCreatePackaging,
  useUpdatePackaging,
} from '../../hooks/usePackagings';
import { formatMoney } from '../../utils/format';
import type { PurchasePackaging } from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  supplyId: string;
  /** When provided, the modal edits this packaging. Otherwise it creates. */
  packaging?: PurchasePackaging | null;
}

interface FormState {
  supplier_id: string;
  name: string;
  units_per_package: string;
  price_per_package: string;
  is_primary: boolean;
  active: boolean;
}

const EMPTY: FormState = {
  supplier_id: '',
  name: '',
  units_per_package: '',
  price_per_package: '',
  is_primary: false,
  active: true,
};

function fromPackaging(p: PurchasePackaging): FormState {
  return {
    supplier_id: p.supplier_id,
    name: p.name,
    units_per_package: String(p.units_per_package),
    // price stored in centavos; display in major units for editing
    price_per_package:
      p.price_per_package !== null && p.price_per_package !== undefined
        ? (Number(p.price_per_package) / 100).toString()
        : '',
    is_primary: p.is_primary,
    active: p.active,
  };
}

export function PackagingFormModal({ open, onClose, supplyId, packaging }: Props) {
  const isEdit = !!packaging;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const suppliersQ = useSuppliers({ active: true });
  const createM = useCreatePackaging();
  const updateM = useUpdatePackaging();

  useEffect(() => {
    if (!open) return;
    setForm(packaging ? fromPackaging(packaging) : EMPTY);
    setErrors({});
    setServerError(null);
  }, [open, packaging]);

  const suppliers = useMemo(
    () => suppliersQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliersQ.data],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.supplier_id) e.supplier_id = 'Supplier is required';
    if (!form.name.trim()) e.name = 'Packaging name is required';
    const upp = Number(form.units_per_package);
    if (!Number.isFinite(upp) || upp <= 0) {
      e.units_per_package = 'Must be a positive number';
    }
    if (form.price_per_package.trim() !== '') {
      const p = Number(form.price_per_package);
      if (!Number.isFinite(p) || p < 0) {
        e.price_per_package = 'Must be a non-negative number';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setServerError(null);

    const priceCentavos = form.price_per_package.trim()
      ? Math.round(Number(form.price_per_package) * 100)
      : null;

    try {
      if (isEdit && packaging) {
        await updateM.mutateAsync({
          id: packaging.id,
          input: {
            name: form.name.trim(),
            units_per_package: Number(form.units_per_package),
            price_per_package: priceCentavos,
            is_primary: form.is_primary,
            active: form.active,
          },
        });
      } else {
        await createM.mutateAsync({
          supply_id: supplyId,
          supplier_id: form.supplier_id,
          name: form.name.trim(),
          units_per_package: Number(form.units_per_package),
          price_per_package: priceCentavos,
          is_primary: form.is_primary,
          active: form.active,
        });
      }
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const pending = createM.isPending || updateM.isPending;

  const unitCost = useMemo(() => {
    const price = Number(form.price_per_package);
    const upp = Number(form.units_per_package);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(upp) || upp <= 0) return null;
    return (price * 100) / upp;
  }, [form.price_per_package, form.units_per_package]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit supplier packaging' : 'Add supplier'}
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        {serverError && (
          <div className="auth-alert" style={{ marginBottom: 12 }}>
            {serverError}
          </div>
        )}

        <Select
          label="Supplier"
          name="supplier_id"
          value={form.supplier_id}
          onValueChange={(v) => set('supplier_id', v)}
          placeholder={suppliersQ.isLoading ? 'Loading…' : 'Select supplier…'}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          error={errors.supplier_id}
          disabled={isEdit || suppliersQ.isLoading}
        />

        <Input
          label="Packaging name"
          name="pkg_name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Box of 6 bottles"
          maxLength={200}
          error={errors.name}
        />

        <div className="section-grid-2">
          <Input
            label="Units per package"
            name="upp"
            type="number"
            step="any"
            min="0"
            value={form.units_per_package}
            onChange={(e) => set('units_per_package', e.target.value)}
            hint="Base units packed inside one package"
            error={errors.units_per_package}
          />
          <Input
            label="Price per package (optional)"
            name="price"
            type="number"
            step="0.01"
            min="0"
            value={form.price_per_package}
            onChange={(e) => set('price_per_package', e.target.value)}
            hint={
              unitCost !== null
                ? `Unit cost ≈ ${formatMoney(unitCost)}`
                : 'Default price in purchase orders'
            }
            error={errors.price_per_package}
          />
        </div>

        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.is_primary}
              onChange={(e) => set('is_primary', e.target.checked)}
              style={{ width: 'auto', height: 'auto' }}
            />
            Primary supplier for this supply
          </label>
          <div className="fs-11 text-muted mt-4">
            The primary supplier is auto-selected when creating a purchase order.
            Only one packaging can be primary per supply.
          </div>
        </div>

        {isEdit && (
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
                style={{ width: 'auto', height: 'auto' }}
              />
              Active
            </label>
          </div>
        )}
      </form>
    </Modal>
  );
}
