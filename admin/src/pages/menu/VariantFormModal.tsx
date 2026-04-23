import { useEffect, useState } from 'react';
import { Modal, Button } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import {
  useCreateVariant,
  useUpdateVariant,
} from '../../hooks/useProducts';
import type { ProductVariant } from '../../types/menu';
import { moneyLabel } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  variant?: ProductVariant | null;
}

interface FormState {
  name: string;
  sell_price: string;
  barcode: string;
  display_order: string;
  active: boolean;
}

const EMPTY: FormState = {
  name: '',
  sell_price: '',
  barcode: '',
  display_order: '0',
  active: true,
};

function fromVariant(v: ProductVariant): FormState {
  return {
    name: v.name,
    sell_price: String(Number(v.sell_price) / 100),
    barcode: v.barcode ?? '',
    display_order: String(v.display_order),
    active: v.active,
  };
}

export function VariantFormModal({ open, onClose, productId, variant }: Props) {
  const isEdit = !!variant;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const createM = useCreateVariant(productId);
  const updateM = useUpdateVariant(productId);

  useEffect(() => {
    if (!open) return;
    setForm(variant ? fromVariant(variant) : EMPTY);
    setErrors({});
    setServerError(null);
  }, [open, variant]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

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
      display_order: Number(form.display_order),
      active: form.active,
    };

    try {
      if (isEdit && variant) {
        await updateM.mutateAsync({ variantId: variant.id, input: payload });
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
      title={isEdit ? 'Edit variant' : 'New variant'}
      size="sm"
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create variant'}
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
          placeholder="e.g. Small 8oz"
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
