import { useEffect, useState } from 'react';
import { Modal, Button } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useCreateProductCategory,
  useProductCategories,
  useUpdateProductCategory,
} from '../../hooks/useProductCategories';
import type { ProductCategory } from '../../types/menu';

interface Props {
  open: boolean;
  onClose: () => void;
  category?: ProductCategory | null;
  /** Pre-fill parent when creating a subcategory from a parent row. */
  defaultParentId?: string | null;
}

interface FormState {
  name: string;
  description: string;
  parent_id: string;
  color: string;
  image_url: string;
  display_order: string;
  visible_in_pos: boolean;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  parent_id: '',
  color: '',
  image_url: '',
  display_order: '0',
  visible_in_pos: true,
};

function fromCategory(c: ProductCategory): FormState {
  return {
    name: c.name,
    description: c.description ?? '',
    parent_id: c.parent_id ?? '',
    color: c.color ?? '',
    image_url: c.image_url ?? '',
    display_order: String(c.display_order),
    visible_in_pos: c.visible_in_pos,
  };
}

export function CategoryFormModal({
  open,
  onClose,
  category,
  defaultParentId,
}: Props) {
  const isEdit = !!category;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const categoriesQ = useProductCategories();
  const createM = useCreateProductCategory();
  const updateM = useUpdateProductCategory();

  useEffect(() => {
    if (!open) return;
    if (category) {
      setForm(fromCategory(category));
    } else {
      setForm({ ...EMPTY, parent_id: defaultParentId ?? '' });
    }
    setErrors({});
    setServerError(null);
  }, [open, category, defaultParentId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  // When editing, exclude self + descendants from the parent picker to avoid
  // trying to create a cycle (the backend rejects it, but we prefilter for UX).
  const parentOptions = (() => {
    const all = categoriesQ.data?.items ?? [];
    if (!category) {
      return all.map((c) => ({ value: c.id, label: c.name }));
    }
    const forbidden = new Set<string>([category.id]);
    // Walk: anything whose ancestor chain includes this category is forbidden.
    // The list endpoint doesn't return parent chains, so we iterate until
    // stable — at most O(N²) over a small menu.
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of all) {
        if (c.parent_id && forbidden.has(c.parent_id) && !forbidden.has(c.id)) {
          forbidden.add(c.id);
          changed = true;
        }
      }
    }
    return all
      .filter((c) => !forbidden.has(c.id))
      .map((c) => ({ value: c.id, label: c.name }));
  })();

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (form.color.trim() && !/^#[0-9a-fA-F]{6}$/.test(form.color.trim())) {
      e.color = 'Must be a #rrggbb hex color';
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
      description: form.description.trim() || null,
      parent_id: form.parent_id || null,
      color: form.color.trim() || null,
      image_url: form.image_url.trim() || null,
      display_order: Number(form.display_order),
      visible_in_pos: form.visible_in_pos,
    };

    try {
      if (isEdit && category) {
        await updateM.mutateAsync({ id: category.id, input: payload });
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
      title={isEdit ? 'Edit category' : 'New category'}
      size="sm"
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create category'}
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
          maxLength={120}
          error={errors.name}
        />

        <Select
          label="Parent category (optional)"
          name="parent_id"
          value={form.parent_id}
          onValueChange={(v) => set('parent_id', v)}
          placeholder={categoriesQ.isLoading ? 'Loading…' : '— top level —'}
          options={parentOptions}
          disabled={categoriesQ.isLoading}
        />

        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="section-grid-2">
          <Input
            label="Color (hex)"
            name="color"
            value={form.color}
            onChange={(e) => set('color', e.target.value)}
            placeholder="#c8922a"
            maxLength={7}
            error={errors.color}
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

        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.visible_in_pos}
              onChange={(e) => set('visible_in_pos', e.target.checked)}
              style={{ width: 'auto', height: 'auto' }}
            />
            Visible in POS
          </label>
        </div>
      </form>
    </Modal>
  );
}
