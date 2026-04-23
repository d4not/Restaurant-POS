import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useCreateModification,
  useUpdateModification,
} from '../../hooks/useProductModifications';
import { useSupplies } from '../../hooks/useSupplies';
import type { ProductModification } from '../../types/menu';
import { moneyLabel } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  modification?: ProductModification | null;
}

interface FormState {
  name: string;
  sell_price: string;
  barcode: string;
  supply_id: string;
  display_order: string;
  active: boolean;
}

const EMPTY: FormState = {
  name: '',
  sell_price: '',
  barcode: '',
  supply_id: '',
  display_order: '0',
  active: true,
};

function fromModification(m: ProductModification): FormState {
  return {
    name: m.name,
    sell_price: String(Number(m.sell_price) / 100),
    barcode: m.barcode ?? '',
    supply_id: m.supply_id ?? '',
    display_order: String(m.display_order),
    active: m.active,
  };
}

export function ModificationFormModal({
  open,
  onClose,
  productId,
  modification,
}: Props) {
  const isEdit = !!modification;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const suppliesQ = useSupplies({ active: true });
  const createM = useCreateModification(productId);
  const updateM = useUpdateModification(productId);

  useEffect(() => {
    if (!open) return;
    setForm(modification ? fromModification(modification) : EMPTY);
    setErrors({});
    setServerError(null);
  }, [open, modification]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const supplyOptions = useMemo(() => {
    const items = suppliesQ.data?.pages.flatMap((p) => p.items) ?? [];
    return items.map((s) => ({ value: s.id, label: s.name }));
  }, [suppliesQ.data]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    const p = Number(form.sell_price);
    if (!form.sell_price.trim() || !Number.isFinite(p) || p < 0) {
      e.sell_price = 'Must be a non-negative number';
    }
    const d = Number(form.display_order);
    if (!Number.isInteger(d) || d < 0) {
      e.display_order = 'Must be a non-negative integer';
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
      sell_price: Math.round(Number(form.sell_price) * 100),
      barcode: form.barcode.trim() || null,
      supply_id: form.supply_id || null,
      display_order: Number(form.display_order),
      active: form.active,
    };

    try {
      if (isEdit && modification) {
        await updateM.mutateAsync({ modificationId: modification.id, input: payload });
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
      title={isEdit ? 'Edit modification' : 'New modification'}
      size="sm"
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create modification'}
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
          placeholder="e.g. Orange, Mango, Pomegranate…"
        />

        <div className="section-grid-2">
          <Input
            label={moneyLabel('Sell price')}
            name="sell_price"
            type="number"
            step="0.01"
            min="0"
            value={form.sell_price}
            onChange={(e) => set('sell_price', e.target.value)}
            error={errors.sell_price}
          />
          <Input
            label="Display order"
            name="display_order"
            type="number"
            min="0"
            value={form.display_order}
            onChange={(e) => set('display_order', e.target.value)}
            error={errors.display_order}
          />
        </div>

        <Input
          label="Barcode (optional)"
          name="barcode"
          value={form.barcode}
          onChange={(e) => set('barcode', e.target.value)}
          maxLength={64}
        />

        <Select
          label="Linked supply (optional)"
          name="supply_id"
          value={form.supply_id}
          onValueChange={(v) => set('supply_id', v)}
          placeholder={suppliesQ.isLoading ? 'Loading…' : '— not linked —'}
          options={supplyOptions}
          disabled={suppliesQ.isLoading}
        />

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
      </form>
    </Modal>
  );
}
