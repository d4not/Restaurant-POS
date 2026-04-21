import { useEffect, useState } from 'react';
import { Modal, Button } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import { useSupplyCategories } from '../../hooks/useSupplyCategories';
import { useCreateSupply, useUpdateSupply } from '../../hooks/useSupplies';
import {
  BASE_UNITS,
  CONTENT_UNITS,
  type BaseUnit,
  type ContentUnit,
  type Supply,
} from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, the modal edits this supply. Otherwise it creates. */
  supply?: Supply | null;
}

interface FormState {
  name: string;
  barcode: string;
  category_id: string;
  base_unit: BaseUnit | '';
  content_per_unit: string;
  content_unit: ContentUnit | '';
  active: boolean;
}

const EMPTY: FormState = {
  name: '',
  barcode: '',
  category_id: '',
  base_unit: '',
  content_per_unit: '',
  content_unit: '',
  active: true,
};

function fromSupply(s: Supply): FormState {
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

export function SupplyFormModal({ open, onClose, supply }: Props) {
  const isEdit = !!supply;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const categoriesQ = useSupplyCategories();
  const createM = useCreateSupply();
  const updateM = useUpdateSupply();

  // Re-seed the form whenever the modal opens or the target supply changes.
  useEffect(() => {
    if (!open) return;
    setForm(supply ? fromSupply(supply) : EMPTY);
    setErrors({});
    setServerError(null);
  }, [open, supply]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.category_id) e.category_id = 'Category is required';
    if (!form.base_unit) e.base_unit = 'Base unit is required';

    const hasCPU = form.content_per_unit.trim() !== '';
    const hasCU = form.content_unit !== '';
    if (hasCPU !== hasCU) {
      e.content_per_unit = 'Provide both content fields or neither';
    } else if (hasCPU) {
      const n = Number(form.content_per_unit);
      if (!Number.isFinite(n) || n <= 0) {
        e.content_per_unit = 'Must be a positive number';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setServerError(null);

    const payload = {
      name: form.name.trim(),
      barcode: form.barcode.trim() || undefined,
      category_id: form.category_id,
      base_unit: form.base_unit as BaseUnit,
      content_per_unit: form.content_per_unit.trim()
        ? Number(form.content_per_unit)
        : undefined,
      content_unit: (form.content_unit || undefined) as ContentUnit | undefined,
      active: form.active,
    };

    try {
      if (isEdit && supply) {
        await updateM.mutateAsync({ id: supply.id, input: payload });
      } else {
        await createM.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const pending = createM.isPending || updateM.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit supply' : 'New supply'}
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit} type="submit">
            {isEdit ? 'Save changes' : 'Create supply'}
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

        <Input
          label="Name"
          name="name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          autoFocus
          maxLength={200}
          error={errors.name}
        />

        <Input
          label="Barcode (optional)"
          name="barcode"
          value={form.barcode}
          onChange={(e) => set('barcode', e.target.value)}
          maxLength={64}
        />

        <Select
          label="Category"
          name="category_id"
          value={form.category_id}
          onValueChange={(v) => set('category_id', v)}
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
            value={form.base_unit}
            onValueChange={(v) => set('base_unit', v as BaseUnit | '')}
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
            value={form.content_per_unit}
            onChange={(e) => set('content_per_unit', e.target.value)}
            hint="e.g. 946 ml per 946ml bottle"
            error={errors.content_per_unit}
          />
        </div>

        <Select
          label="Content unit"
          name="content_unit"
          value={form.content_unit}
          onValueChange={(v) => set('content_unit', v as ContentUnit | '')}
          placeholder="— none —"
          options={CONTENT_UNITS.map((u) => ({ value: u, label: u }))}
        />

        <div className="field">
          <label htmlFor="active" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="active"
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
              style={{ width: 'auto', height: 'auto' }}
            />
            Active
          </label>
        </div>
      </form>
    </Modal>
  );
}
