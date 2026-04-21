import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Badge } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useCreateProduct,
  useUpdateProduct,
} from '../../hooks/useProducts';
import { useProductCategories } from '../../hooks/useProductCategories';
import { useSupplies } from '../../hooks/useSupplies';
import { productTypeHint, productTypeTone } from './product-meta';
import {
  PRODUCT_TYPES,
  type CreateProductInput,
  type Product,
  type ProductType,
} from '../../types/menu';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, the modal edits this product. Otherwise it creates. */
  product?: Product | null;
  /** When true we skip the type picker and jump straight to the fields. */
  lockType?: boolean;
  onCreated?: (p: Product) => void;
}

type Step = 'type' | 'fields';

interface FormState {
  type: ProductType | '';
  name: string;
  category_id: string;
  sell_price: string;
  barcode: string;
  supply_id: string;
  icon_color: string;
  sold_by_weight: boolean;
  allow_discount: boolean;
  active: boolean;
}

const EMPTY: FormState = {
  type: '',
  name: '',
  category_id: '',
  sell_price: '',
  barcode: '',
  supply_id: '',
  icon_color: '',
  sold_by_weight: false,
  allow_discount: true,
  active: true,
};

function fromProduct(p: Product): FormState {
  return {
    type: p.type,
    name: p.name,
    category_id: p.category_id ?? '',
    sell_price: p.sell_price ? String(Number(p.sell_price) / 100) : '',
    barcode: p.barcode ?? '',
    supply_id: p.supply_id ?? '',
    icon_color: p.icon_color ?? '',
    sold_by_weight: p.sold_by_weight,
    allow_discount: p.allow_discount,
    active: p.active,
  };
}

export function ProductFormModal({
  open,
  onClose,
  product,
  lockType,
  onCreated,
}: Props) {
  const isEdit = !!product;

  // Step 1 (new only): pick a type. Once picked, the form shows type-specific fields.
  // Editing always starts on the fields step since the type can't change.
  const [step, setStep] = useState<Step>(isEdit ? 'fields' : 'type');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const categoriesQ = useProductCategories();
  const suppliesQ = useSupplies({ active: true });
  const createM = useCreateProduct();
  const updateM = useUpdateProduct();

  useEffect(() => {
    if (!open) return;
    setForm(product ? fromProduct(product) : EMPTY);
    setErrors({});
    setServerError(null);
    setStep(isEdit || lockType ? 'fields' : 'type');
  }, [open, product, isEdit, lockType]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const supplyOptions = useMemo(() => {
    const items = suppliesQ.data?.pages.flatMap((p) => p.items) ?? [];
    return items.map((s) => ({ value: s.id, label: s.name }));
  }, [suppliesQ.data]);

  const categoryOptions = useMemo(
    () =>
      categoriesQ.data?.items.map((c) => ({ value: c.id, label: c.name })) ??
      [],
    [categoriesQ.data],
  );

  const isPrep = form.type === 'PREPARATION';

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.type) e.type = 'Select a type';
    if (!form.name.trim()) e.name = 'Name is required';

    if (!isPrep) {
      if (form.sell_price.trim()) {
        const n = Number(form.sell_price);
        if (!Number.isFinite(n) || n < 0) {
          e.sell_price = 'Must be a non-negative number';
        }
      }
      if (form.icon_color.trim() && !/^#[0-9a-fA-F]{6}$/.test(form.icon_color.trim())) {
        e.icon_color = 'Must be a #rrggbb hex color';
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setServerError(null);

    const sell_price = form.sell_price.trim()
      ? Math.round(Number(form.sell_price) * 100)
      : null;

    const payload: CreateProductInput = {
      name: form.name.trim(),
      type: form.type as ProductType,
      // PREPARATION rejects category/supply/sell_price on the backend — send null.
      category_id: isPrep ? null : form.category_id || null,
      sell_price: isPrep ? null : sell_price,
      barcode: form.barcode.trim() || null,
      supply_id: form.type === 'PRODUCT' ? form.supply_id || null : null,
      icon_color: isPrep ? null : form.icon_color.trim() || null,
      sold_by_weight: isPrep ? false : form.sold_by_weight,
      allow_discount: form.allow_discount,
      active: form.active,
    };

    try {
      if (isEdit && product) {
        // Don't send `type` on update — backend allows changing it but doing
        // so destroys consistency with the variants/recipes tree.
        const { type, ...rest } = payload;
        void type;
        await updateM.mutateAsync({ id: product.id, input: rest });
        onClose();
      } else {
        const created = await createM.mutateAsync(payload);
        onCreated?.(created);
        onClose();
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const pending = createM.isPending || updateM.isPending;

  /* ── Step 1: type picker ─────────────────────────────── */

  if (step === 'type') {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="New product"
        closeOnOverlay={!pending}
        footer={
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        }
      >
        <p className="fs-12 text-muted mb-16">
          What kind of menu item are you adding? The form fields change based on your choice.
        </p>
        <div className="type-picker">
          {PRODUCT_TYPES.map((t) => (
            <button
              type="button"
              key={t}
              className="type-picker-card"
              onClick={() => {
                set('type', t);
                setStep('fields');
              }}
            >
              <div className="type-picker-head">
                <Badge tone={productTypeTone(t)}>{t}</Badge>
              </div>
              <div className="type-picker-body">{productTypeHint(t)}</div>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  /* ── Step 2: fields, configured per type ─────────────── */

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isEdit
          ? 'Edit product'
          : `New ${form.type?.toLowerCase() || 'product'}`
      }
      closeOnOverlay={!pending}
      footer={
        <>
          {!isEdit && !lockType && (
            <Button variant="ghost" onClick={() => setStep('type')} disabled={pending}>
              ← Back
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create'}
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

        {form.type && (
          <div className="mb-12 flex gap-8" style={{ alignItems: 'center' }}>
            <Badge tone={productTypeTone(form.type)}>{form.type}</Badge>
            <span className="fs-12 text-muted">{productTypeHint(form.type)}</span>
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

        {!isPrep && (
          <div className="section-grid-2">
            <Select
              label="Category"
              name="category_id"
              value={form.category_id}
              onValueChange={(v) => set('category_id', v)}
              placeholder={
                categoriesQ.isLoading ? 'Loading…' : '— none —'
              }
              options={categoryOptions}
              disabled={categoriesQ.isLoading}
            />
            <Input
              label="Sell price (MXN)"
              name="sell_price"
              type="number"
              step="0.01"
              min="0"
              value={form.sell_price}
              onChange={(e) => set('sell_price', e.target.value)}
              error={errors.sell_price}
              hint="Leave blank if the price is set per variant."
            />
          </div>
        )}

        <div className="section-grid-2">
          <Input
            label="Barcode (optional)"
            name="barcode"
            value={form.barcode}
            onChange={(e) => set('barcode', e.target.value)}
            maxLength={64}
          />
          {!isPrep && (
            <Input
              label="Icon color (hex)"
              name="icon_color"
              value={form.icon_color}
              onChange={(e) => set('icon_color', e.target.value)}
              placeholder="#c8922a"
              maxLength={7}
              error={errors.icon_color}
            />
          )}
        </div>

        {form.type === 'PRODUCT' && (
          <Select
            label="Linked supply (optional)"
            name="supply_id"
            value={form.supply_id}
            onValueChange={(v) => set('supply_id', v)}
            placeholder={
              suppliesQ.isLoading ? 'Loading…' : '— not linked —'
            }
            options={supplyOptions}
            disabled={suppliesQ.isLoading}
          />
        )}

        <div className="flex gap-16" style={{ flexWrap: 'wrap' }}>
          {!isPrep && (
            <label className="flex gap-8" style={{ alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.sold_by_weight}
                onChange={(e) => set('sold_by_weight', e.target.checked)}
                style={{ width: 'auto', height: 'auto' }}
              />
              Sold by weight
            </label>
          )}
          <label className="flex gap-8" style={{ alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={form.allow_discount}
              onChange={(e) => set('allow_discount', e.target.checked)}
              style={{ width: 'auto', height: 'auto' }}
            />
            Allow discount
          </label>
          <label className="flex gap-8" style={{ alignItems: 'center', fontSize: 13 }}>
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
