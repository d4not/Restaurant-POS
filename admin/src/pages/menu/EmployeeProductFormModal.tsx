import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import { useProducts } from '../../hooks/useProducts';
import {
  useCreateEmployeeProduct,
  useUpdateEmployeeProduct,
} from '../../hooks/useEmployeeProducts';
import { moneyLabel } from '../../utils/format';
import type { Product } from '../../types/menu';
import type { EmployeeProduct } from '../../api/employee-products';
import { useTranslation } from '../../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, the modal edits this entry instead of creating one. */
  entry?: EmployeeProduct | null;
}

interface FormState {
  product_id: string;
  variant_id: string;
  employee_price: string;
  label: string;
  active: boolean;
}

const EMPTY: FormState = {
  product_id: '',
  variant_id: '',
  employee_price: '',
  label: '',
  active: true,
};

function fromEntry(e: EmployeeProduct): FormState {
  return {
    product_id: e.product_id,
    variant_id: e.variant_id ?? '',
    employee_price: String(Number(e.employee_price) / 100),
    label: e.label ?? '',
    active: e.active,
  };
}

export function EmployeeProductFormModal({ open, onClose, entry }: Props) {
  const { t } = useTranslation();
  const isEdit = !!entry;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Pull the active products catalogue (excluding PREPARATIONs). The backend
  // also rejects PREPARATION on create — we filter client-side so the picker
  // doesn't even offer them.
  const productsQ = useProducts({ active: true });
  const products = useMemo<Product[]>(
    () =>
      (productsQ.data?.pages.flatMap((p) => p.items) ?? []).filter(
        (p) => p.type !== 'PREPARATION',
      ),
    [productsQ.data],
  );

  const createM = useCreateEmployeeProduct();
  const updateM = useUpdateEmployeeProduct();

  useEffect(() => {
    if (!open) return;
    setForm(entry ? fromEntry(entry) : EMPTY);
    setErrors({});
    setServerError(null);
  }, [open, entry]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === form.product_id) ?? null,
    [products, form.product_id],
  );
  const variantOptions = useMemo(
    () =>
      (selectedProduct?.variants ?? []).map((v) => ({
        value: v.id,
        label: `${v.name} — $${(Number(v.sell_price) / 100).toFixed(2)}`,
      })),
    [selectedProduct],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onProductChange = (id: string) => {
    // Reset the variant whenever the product changes — a variant id from a
    // previous product would be rejected by the backend's belongs-to check.
    setForm((f) => ({ ...f, product_id: id, variant_id: '' }));
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.product_id) e.product_id = t('employeeProducts.errProductRequired');
    const priceNum = Number(form.employee_price);
    if (!form.employee_price.trim() || !Number.isFinite(priceNum) || priceNum < 0) {
      e.employee_price = t('employeeProducts.errPriceRequired');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setServerError(null);

    const employee_price = Math.round(Number(form.employee_price) * 100);

    try {
      if (isEdit && entry) {
        await updateM.mutateAsync({
          id: entry.id,
          input: {
            employee_price,
            label: form.label.trim() || null,
            active: form.active,
          },
        });
      } else {
        await createM.mutateAsync({
          product_id: form.product_id,
          variant_id: form.variant_id || null,
          employee_price,
          label: form.label.trim() || null,
          active: form.active,
        });
      }
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const pending = createM.isPending || updateM.isPending;

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.name })),
    [products],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('employeeProducts.editTitle') : t('employeeProducts.newTitle')}
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? t('common.save') : t('common.create')}
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

        <p className="fs-12 text-muted mb-16">
          {t('employeeProducts.formHint')}
        </p>

        <Select
          label={t('employeeProducts.product')}
          name="product_id"
          value={form.product_id}
          onValueChange={onProductChange}
          options={productOptions}
          placeholder={productsQ.isLoading ? t('common.loading') : '—'}
          disabled={isEdit || productsQ.isLoading}
          error={errors.product_id}
        />

        {selectedProduct && variantOptions.length > 0 && (
          <Select
            label={t('employeeProducts.variant')}
            name="variant_id"
            value={form.variant_id}
            onValueChange={(v) => set('variant_id', v)}
            options={[
              { value: '', label: t('employeeProducts.baseProduct') },
              ...variantOptions,
            ]}
            disabled={isEdit}
            hint={t('employeeProducts.variantHint')}
          />
        )}

        <Input
          label={moneyLabel(t('employeeProducts.employeePrice'))}
          name="employee_price"
          type="number"
          step="0.01"
          min="0"
          value={form.employee_price}
          onChange={(e) => set('employee_price', e.target.value)}
          error={errors.employee_price}
          hint={t('employeeProducts.priceHint')}
        />

        <Input
          label={t('employeeProducts.label')}
          name="label"
          value={form.label}
          onChange={(e) => set('label', e.target.value)}
          maxLength={200}
          hint={t('employeeProducts.labelHint')}
        />

        <label className="flex gap-8" style={{ alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
            style={{ width: 'auto', height: 'auto' }}
          />
          {t('common.active')}
        </label>
      </form>
    </Modal>
  );
}
