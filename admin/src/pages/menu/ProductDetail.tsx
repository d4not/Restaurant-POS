import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { ImagePicker } from '../../components/forms/ImagePicker';
import {
  useDeleteProduct,
  useDeleteVariant,
  useDetachModifierGroup,
  useProduct,
  useUpdateProduct,
} from '../../hooks/useProducts';
import {
  useDeleteModification,
  useModifications,
} from '../../hooks/useProductModifications';
import {
  useDeleteOverride,
  useModifierOverrides,
} from '../../hooks/useModifierOverrides';
import { useProductCategories } from '../../hooks/useProductCategories';
import { useSettings } from '../../hooks/useSettings';
import { useTaxes } from '../../hooks/useTaxes';
import {
  formatMoney,
  formatNumber,
  formatPct,
  moneyLabel,
} from '../../utils/format';
import type {
  Modifier,
  ModifierGroupLink,
  ModifierProductOverride,
  Product,
  ProductModification,
  ProductVariant,
  UpdateProductInput,
} from '../../types/menu';
import { productTypeTone, productTypeLabel } from './product-meta';
import { VariantFormModal } from './VariantFormModal';
import { ModificationFormModal } from './ModificationFormModal';
import { AttachModifierGroupModal } from './AttachModifierGroupModal';
import { OverrideFormModal } from './OverrideFormModal';
import { RecipeEditor } from './RecipeEditor';

export function ProductDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const productQ = useProduct(id);
  const modsQ = useModifications(id, { enabled: productQ.data?.type === 'PRODUCT' });
  const overridesQ = useModifierOverrides(id);

  const [variantModal, setVariantModal] = useState<{
    open: boolean;
    variant: ProductVariant | null;
  }>({ open: false, variant: null });
  const [modModal, setModModal] = useState<{
    open: boolean;
    modification: ProductModification | null;
  }>({ open: false, modification: null });
  const [attachOpen, setAttachOpen] = useState(false);
  const [overrideModal, setOverrideModal] = useState<{
    open: boolean;
    modifier: Modifier | null;
    groupType: 'SWAP' | 'ADD';
    existing: ModifierProductOverride | null;
  }>({ open: false, modifier: null, groupType: 'ADD', existing: null });

  const deleteOverride = useDeleteOverride(id);

  // For DISH with variants we show a recipe per variant, selected via pill.
  // Default to the first variant once loaded.
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

  const deleteProduct = useDeleteProduct();
  const deleteVariant = useDeleteVariant(id);
  const deleteModification = useDeleteModification(id);
  const detachGroup = useDetachModifierGroup(id);
  const updateProduct = useUpdateProduct();

  const categoriesQ = useProductCategories();
  const categoryOptions = useMemo(
    () =>
      categoriesQ.data?.items.map((c) => ({ value: c.id, label: c.name })) ?? [],
    [categoriesQ.data],
  );

  const taxesQ = useTaxes({ active: true });
  const settingsQ = useSettings();
  const taxOptions = useMemo(() => {
    const taxes = taxesQ.data ?? [];
    const defaultTaxId = settingsQ.data?.default_tax_id ?? '';
    const defaultTax = defaultTaxId
      ? taxes.find((t) => t.id === defaultTaxId)
      : null;
    const defaultLabel = defaultTax
      ? `Default (${defaultTax.name} — ${Number(defaultTax.rate).toFixed(2)}%)`
      : 'Default (no tax)';
    return [
      { value: '', label: defaultLabel },
      ...taxes.map((t) => ({
        value: t.id,
        label: `${t.name} — ${Number(t.rate).toFixed(2)}%`,
      })),
    ];
  }, [taxesQ.data, settingsQ.data]);

  const product = productQ.data;

  // ── Inline edit state ──────────────────────────────────────
  // `form` tracks every editable header field. We diff against the latest
  // server-fetched product via `buildFormState` so the dirty check stays
  // accurate across refetches (after save, the product data refreshes and
  // buildFormState produces a matching snapshot — dirty clears automatically).
  const [form, setForm] = useState<HeaderFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (product) setForm(buildFormState(product));
  }, [product]);

  const setField = <K extends keyof HeaderFormState>(
    key: K,
    value: HeaderFormState[K],
  ) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
    setSaveError(null);
  };

  const isDirty = useMemo(() => {
    if (!product || !form) return false;
    const original = buildFormState(product);
    return (Object.keys(form) as (keyof HeaderFormState)[]).some(
      (k) => form[k] !== original[k],
    );
  }, [product, form]);

  const onDiscard = () => {
    if (!product) return;
    setForm(buildFormState(product));
    setFieldErrors({});
    setSaveError(null);
  };

  const onSave = async () => {
    if (!product || !form) return;
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    const isPrepForm = product.type === 'PREPARATION';
    if (!isPrepForm && form.sell_price.trim()) {
      const n = Number(form.sell_price);
      if (!Number.isFinite(n) || n < 0) {
        errors.sell_price = 'Must be a non-negative number';
      }
    }
    if (
      !isPrepForm &&
      form.icon_color.trim() &&
      !/^#[0-9a-fA-F]{6}$/.test(form.icon_color.trim())
    ) {
      errors.icon_color = 'Must be a #rrggbb hex color';
    }
    if (!isPrepForm && form.image_url.trim().length > 500) {
      errors.image_url = 'URL is too long (max 500 chars)';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // Send only fields that actually changed so unrelated validation on the
    // backend (e.g. category_id on a PREPARATION) doesn't fire on a no-op edit.
    const original = buildFormState(product);
    const payload: UpdateProductInput = {};
    if (form.name.trim() !== original.name) payload.name = form.name.trim();
    if (form.category_id !== original.category_id) {
      payload.category_id = form.category_id || null;
    }
    if (form.sell_price !== original.sell_price) {
      payload.sell_price = form.sell_price.trim()
        ? Math.round(Number(form.sell_price) * 100)
        : null;
    }
    if (form.barcode !== original.barcode) {
      payload.barcode = form.barcode.trim() || null;
    }
    if (form.icon_color !== original.icon_color) {
      payload.icon_color = form.icon_color.trim() || null;
    }
    if (form.image_url !== original.image_url) {
      payload.image_url = form.image_url.trim() || null;
    }
    if (form.sold_by_weight !== original.sold_by_weight) {
      payload.sold_by_weight = form.sold_by_weight;
    }
    if (form.allow_discount !== original.allow_discount) {
      payload.allow_discount = form.allow_discount;
    }
    if (form.tax_id !== original.tax_id) {
      payload.tax_id = form.tax_id || null;
    }
    if (form.active !== original.active) payload.active = form.active;

    setSaveError(null);
    try {
      await updateProduct.mutateAsync({ id: product.id, input: payload });
      setFieldErrors({});
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const variants = useMemo<ProductVariant[]>(
    () => product?.variants ?? [],
    [product],
  );

  // Keep the active variant valid as the list changes.
  const effectiveVariantId = useMemo(() => {
    if (variants.length === 0) return null;
    if (activeVariantId && variants.some((v) => v.id === activeVariantId)) {
      return activeVariantId;
    }
    return variants[0].id;
  }, [variants, activeVariantId]);

  if (productQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading product…
      </div>
    );
  }

  if (productQ.error || !product) {
    return (
      <EmptyState
        icon="⚠"
        message="Product not found"
        sub={(productQ.error as Error | null)?.message}
        action={
          <Link to="/menu/products">
            <Button variant="secondary">Back to products</Button>
          </Link>
        }
      />
    );
  }

  const isDish = product.type === 'DISH';
  const isPrep = product.type === 'PREPARATION';
  const isProd = product.type === 'PRODUCT';

  const onDeleteProduct = async () => {
    if (!confirm(`Delete "${product.name}"? It will be archived (soft delete).`)) return;
    try {
      await deleteProduct.mutateAsync(product.id);
      window.location.href = '/menu/products';
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const onDeleteVariant = async (v: ProductVariant) => {
    if (!confirm(`Delete variant "${v.name}"?`)) return;
    try {
      await deleteVariant.mutateAsync(v.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const onDeleteModification = async (m: ProductModification) => {
    if (!confirm(`Delete modification "${m.name}"?`)) return;
    try {
      await deleteModification.mutateAsync(m.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const onDetachGroup = async (link: ModifierGroupLink) => {
    if (!confirm(`Detach "${link.modifier_group.name}" from this product?`)) return;
    try {
      await detachGroup.mutateAsync(link.modifier_group_id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Detach failed');
    }
  };

  const priceDisplay = (() => {
    if (variants.length > 0) {
      const prices = variants.map((v) => Number(v.sell_price));
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      if (min === max) return formatMoney(min);
      return `${formatMoney(min)} – ${formatMoney(max)}`;
    }
    return product.sell_price ? formatMoney(product.sell_price) : '—';
  })();

  const modifications = modsQ.data ?? [];

  const variantColumns: TableColumn<ProductVariant>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '2fr',
      render: (v) => (
        <div>
          <div className="fw-600 fs-13">{v.name}</div>
          {v.barcode && <div className="fs-11 text-muted">{v.barcode}</div>}
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      width: '120px',
      render: (v) => (
        <span className="fw-600 fs-13">{formatMoney(v.sell_price)}</span>
      ),
    },
    {
      key: 'recipe_cost',
      header: 'Recipe cost',
      width: '130px',
      render: (v) => (
        <span className="fs-13 text-muted">
          {Number(v.recipe_cost) > 0 ? formatMoney(v.recipe_cost) : '—'}
        </span>
      ),
    },
    {
      key: 'food_cost',
      header: 'Food cost',
      width: '120px',
      render: (v) => {
        const pct = Number(v.food_cost_pct);
        if (!pct) return <span className="fs-12 text-muted">—</span>;
        const tone = pct > 35 ? 'text-red' : pct > 28 ? 'text-gold' : 'text-green';
        return <span className={`fw-600 fs-13 ${tone}`}>{formatPct(pct)}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      render: (v) =>
        v.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>,
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (v) => (
        <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(ev) => {
              ev.stopPropagation();
              setVariantModal({ open: true, variant: v });
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(ev) => {
              ev.stopPropagation();
              onDeleteVariant(v);
            }}
          >
            ✕
          </button>
        </div>
      ),
    },
  ];

  const modColumns: TableColumn<ProductModification>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '2fr',
      render: (m) => (
        <div>
          <div className="fw-600 fs-13">{m.name}</div>
          {m.barcode && <div className="fs-11 text-muted">{m.barcode}</div>}
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      width: '120px',
      render: (m) => (
        <span className="fw-600 fs-13">{formatMoney(m.sell_price)}</span>
      ),
    },
    {
      key: 'supply',
      header: 'Linked supply',
      width: '1.5fr',
      render: (m) => (
        <span className="fs-12 text-muted">{m.supply?.name ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      render: (m) =>
        m.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>,
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (m) => (
        <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(ev) => {
              ev.stopPropagation();
              setModModal({ open: true, modification: m });
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(ev) => {
              ev.stopPropagation();
              onDeleteModification(m);
            }}
          >
            ✕
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      {/* Unsaved-changes banner. Rendered inline at the top of the page so
          it lives in normal flow — no fixed/sticky positioning to fight with. */}
      {isDirty && (
        <div className="save-bar" role="region" aria-label="Unsaved changes">
          <span className="save-bar-msg">Unsaved changes</span>
          <div className="save-bar-actions">
            <Button
              variant="ghost"
              onClick={onDiscard}
              disabled={updateProduct.isPending}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={onSave}
              loading={updateProduct.isPending}
            >
              Save changes
            </Button>
          </div>
        </div>
      )}

      {/* Header — inline edit form. The page is the edit form; there's no modal. */}
      <div
        className="flex-between mb-16"
        style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}
      >
        <div style={{ flex: 1, minWidth: 320 }}>
          <Link
            to="/menu/products"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← Back to products
          </Link>
          <div className="flex gap-8 mt-4" style={{ alignItems: 'center' }}>
            <Badge tone={productTypeTone(product.type)}>
              {productTypeLabel(product.type)}
            </Badge>
            {form?.active ? (
              <Badge tone="green">Active</Badge>
            ) : (
              <Badge tone="red">Inactive</Badge>
            )}
          </div>
        </div>
        <div className="flex gap-8">
          <Button variant="danger" onClick={onDeleteProduct} loading={deleteProduct.isPending}>
            Delete
          </Button>
        </div>
      </div>

      {form && (
        <Card className="mb-16">
          {saveError && (
            <div className="auth-alert" style={{ marginBottom: 12 }}>
              {saveError}
            </div>
          )}

          {/* Product name — styled like a heading so it doesn't look like a form field. */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="product-name">Product name</label>
            <input
              id="product-name"
              className="product-name-input"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              maxLength={200}
              placeholder="Product name"
            />
            {fieldErrors.name && (
              <div className="field-error">{fieldErrors.name}</div>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {!isPrep && (
              <div className="field">
                <label htmlFor="product-category">Category</label>
                <select
                  id="product-category"
                  value={form.category_id}
                  onChange={(e) => setField('category_id', e.target.value)}
                  disabled={categoriesQ.isLoading}
                >
                  <option value="">— none —</option>
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!isPrep && (
              <div className="field">
                <label htmlFor="product-sell-price">{moneyLabel('Sell price')}</label>
                <input
                  id="product-sell-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.sell_price}
                  onChange={(e) => setField('sell_price', e.target.value)}
                  placeholder={variants.length > 0 ? 'Set per variant' : ''}
                />
                {fieldErrors.sell_price ? (
                  <div className="field-error">{fieldErrors.sell_price}</div>
                ) : variants.length > 0 ? (
                  <div className="fs-11 text-muted mt-4">
                    Leave blank when the price is set on each variant.
                  </div>
                ) : null}
              </div>
            )}

            <div className="field">
              <label htmlFor="product-barcode">Barcode</label>
              <input
                id="product-barcode"
                value={form.barcode}
                onChange={(e) => setField('barcode', e.target.value)}
                maxLength={64}
                placeholder="optional"
              />
            </div>

            {!isPrep && (
              <div className="field">
                <label htmlFor="product-tax">Tax</label>
                <select
                  id="product-tax"
                  value={form.tax_id}
                  onChange={(e) => setField('tax_id', e.target.value)}
                  disabled={taxesQ.isLoading || settingsQ.isLoading}
                >
                  {taxOptions.map((opt) => (
                    <option key={opt.value || 'default'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="fs-11 text-muted mt-4">
                  Price includes tax. Tax is calculated internally.
                </div>
              </div>
            )}

            {!isPrep && (
              <div className="field">
                <label htmlFor="product-icon-color">Icon color</label>
                <div className="flex gap-8" style={{ alignItems: 'center' }}>
                  <input
                    type="color"
                    value={form.icon_color || '#c8922a'}
                    onChange={(e) => setField('icon_color', e.target.value)}
                    style={{
                      width: 40,
                      height: 36,
                      padding: 2,
                      border: '1px solid var(--border2)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      background: 'var(--bg)',
                    }}
                    aria-label="Pick icon color"
                  />
                  <input
                    id="product-icon-color"
                    value={form.icon_color}
                    onChange={(e) => setField('icon_color', e.target.value)}
                    placeholder="#c8922a"
                    maxLength={7}
                    style={{ flex: 1 }}
                  />
                </div>
                {fieldErrors.icon_color && (
                  <div className="field-error">{fieldErrors.icon_color}</div>
                )}
              </div>
            )}

            {!isPrep && (
              <ImagePicker
                label="Image"
                value={form.image_url}
                onChange={(v) => setField('image_url', v)}
                error={fieldErrors.image_url}
                compact
              />
            )}
          </div>

          <div
            className="flex gap-16 mt-4"
            style={{ flexWrap: 'wrap', paddingTop: 4 }}
          >
            {!isPrep && (
              <label
                className="flex gap-8"
                style={{ alignItems: 'center', fontSize: 13, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={form.sold_by_weight}
                  onChange={(e) => setField('sold_by_weight', e.target.checked)}
                />
                Sold by weight
              </label>
            )}
            <label
              className="flex gap-8"
              style={{ alignItems: 'center', fontSize: 13, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={form.allow_discount}
                onChange={(e) => setField('allow_discount', e.target.checked)}
              />
              Allow discount
            </label>
            <label
              className="flex gap-8"
              style={{ alignItems: 'center', fontSize: 13, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setField('active', e.target.checked)}
              />
              Active
            </label>
          </div>
        </Card>
      )}

      {/* Summary cards */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi">
          <div className="kpi-label">Price</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>
            {priceDisplay}
          </div>
          {variants.length > 0 && (
            <div className="kpi-sub">
              {variants.length} variant{variants.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-label">Recipe cost</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>
            {Number(product.recipe_cost) > 0
              ? formatMoney(product.recipe_cost)
              : '—'}
          </div>
          <div className="kpi-sub">cached from latest recipe</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Food cost %</div>
          <div
            className="kpi-value"
            style={{
              fontSize: 20,
              color:
                Number(product.food_cost_pct) > 35
                  ? 'var(--red)'
                  : Number(product.food_cost_pct) > 28
                    ? 'var(--gold)'
                    : 'var(--green)',
            }}
          >
            {Number(product.food_cost_pct) > 0
              ? formatPct(product.food_cost_pct)
              : '—'}
          </div>
          <div className="kpi-sub">target &lt; 30%</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Markup</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>
            {Number(product.markup) > 0 ? `${formatNumber(product.markup, 2)}×` : '—'}
          </div>
          <div className="kpi-sub">sell price ÷ cost</div>
        </div>
      </div>

      {/* Variants (DISH only) */}
      {isDish && (
        <div className="detail-section">
          <div className="flex-between mb-8">
            <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
              Variants (sizes)
            </h3>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setVariantModal({ open: true, variant: null })}
            >
              + Add variant
            </Button>
          </div>
          <Table
            columns={variantColumns}
            rows={variants}
            getRowKey={(v) => v.id}
            emptyMessage="No variants yet"
            emptySub="Dishes can have size variants (small, medium, large) with different prices and recipes."
          />
        </div>
      )}

      {/* Modifier groups (DISH + PRODUCT) */}
      {!isPrep && (
        <div className="detail-section">
          <div className="flex-between mb-8">
            <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
              Modifier groups
            </h3>
            <Button variant="primary" size="sm" onClick={() => setAttachOpen(true)}>
              + Attach group
            </Button>
          </div>
          <ModifierGroupList
            productName={product.name}
            links={product.modifier_groups ?? []}
            overrides={overridesQ.data ?? []}
            onDetach={onDetachGroup}
            detaching={detachGroup.isPending}
            onOverride={(mod, groupType, existing) =>
              setOverrideModal({
                open: true,
                modifier: mod,
                groupType,
                existing: existing ?? null,
              })
            }
            onDeleteOverride={async (mod) => {
              if (!confirm(`Remove override for "${mod.name}"?`)) return;
              try {
                await deleteOverride.mutateAsync(mod.id);
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Delete failed');
              }
            }}
          />
        </div>
      )}

      {/* Modifications (PRODUCT only) */}
      {isProd && (
        <div className="detail-section">
          <div className="flex-between mb-8">
            <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
              Modifications
            </h3>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setModModal({ open: true, modification: null })}
            >
              + Add modification
            </Button>
          </div>
          <Table
            columns={modColumns}
            rows={modifications}
            getRowKey={(m) => m.id}
            isInitialLoad={modsQ.isLoading}
            error={modsQ.error as Error | null}
            emptyMessage="No modifications yet"
            emptySub="Modifications are flavor or content choices for a packaged product (e.g. juice flavors)."
          />
        </div>
      )}

      {/* Recipe section (DISH + PREPARATION) */}
      {(isDish || isPrep) && (
        <div className="detail-section">
          <div className="flex-between mb-8">
            <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
              Recipe
              {isDish && variants.length > 0 && (
                <span className="fs-11 text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                  (one recipe per variant)
                </span>
              )}
            </h3>
          </div>

          {/* DISH with variants: pick which variant's recipe to edit */}
          {isDish && variants.length > 0 && (
            <div className="flex gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`filter-pill ${effectiveVariantId === v.id ? 'active' : ''}`}
                  onClick={() => setActiveVariantId(v.id)}
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}

          {/* Render the right recipe editor */}
          {(() => {
            if (isPrep) {
              return (
                <Card>
                  <RecipeEditor
                    owner={{ kind: 'product', id: product.id }}
                    requiresYield
                    cachedCost={product.recipe_cost}
                  />
                </Card>
              );
            }
            // DISH without variants → product-level recipe
            if (variants.length === 0) {
              return (
                <Card>
                  <RecipeEditor
                    owner={{ kind: 'product', id: product.id }}
                    requiresYield={false}
                    cachedCost={product.recipe_cost}
                    sellPrice={product.sell_price}
                  />
                </Card>
              );
            }
            // DISH with variants → variant-level recipe
            const active = variants.find((v) => v.id === effectiveVariantId);
            if (!active) return null;
            return (
              <Card>
                <RecipeEditor
                  key={active.id}
                  owner={{ kind: 'variant', id: active.id }}
                  requiresYield={false}
                  cachedCost={active.recipe_cost}
                  sellPrice={active.sell_price}
                />
              </Card>
            );
          })()}
        </div>
      )}

      {/* Modals */}
      <VariantFormModal
        open={variantModal.open}
        onClose={() => setVariantModal({ open: false, variant: null })}
        productId={product.id}
        variant={variantModal.variant}
      />
      <ModificationFormModal
        open={modModal.open}
        onClose={() => setModModal({ open: false, modification: null })}
        productId={product.id}
        modification={modModal.modification}
      />
      <AttachModifierGroupModal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        productId={product.id}
        attachedIds={(product.modifier_groups ?? []).map((l) => l.modifier_group_id)}
      />
      <OverrideFormModal
        open={overrideModal.open}
        onClose={() =>
          setOverrideModal({
            open: false,
            modifier: null,
            groupType: 'ADD',
            existing: null,
          })
        }
        productId={product.id}
        productName={product.name}
        modifier={overrideModal.modifier}
        groupType={overrideModal.groupType}
        existingOverride={overrideModal.existing}
      />

    </>
  );
}

/* ───────────────────────────────────────────────────────── */

interface HeaderFormState {
  name: string;
  category_id: string;
  sell_price: string;
  barcode: string;
  // '' means "use the default tax from settings" (persisted as null).
  tax_id: string;
  icon_color: string;
  image_url: string;
  sold_by_weight: boolean;
  allow_discount: boolean;
  active: boolean;
}

// Single source of truth for "form initial values given a Product". Called on
// mount and again after save so the form stays in sync with the server.
function buildFormState(p: Product): HeaderFormState {
  return {
    name: p.name,
    category_id: p.category_id ?? '',
    sell_price: p.sell_price ? String(Number(p.sell_price) / 100) : '',
    barcode: p.barcode ?? '',
    tax_id: p.tax_id ?? '',
    icon_color: p.icon_color ?? '',
    image_url: p.image_url ?? '',
    sold_by_weight: p.sold_by_weight,
    allow_discount: p.allow_discount,
    active: p.active,
  };
}

/* ───────────────────────────────────────────────────────── */

interface GroupListProps {
  productName: string;
  links: ModifierGroupLink[];
  overrides: ModifierProductOverride[];
  onDetach: (link: ModifierGroupLink) => void;
  detaching: boolean;
  onOverride: (
    modifier: Modifier,
    groupType: 'SWAP' | 'ADD',
    existing?: ModifierProductOverride,
  ) => void;
  onDeleteOverride: (modifier: Modifier) => void;
}

function ModifierGroupList({
  links,
  overrides,
  onDetach,
  detaching,
  onOverride,
  onDeleteOverride,
}: GroupListProps) {
  if (links.length === 0) {
    return (
      <EmptyState
        message="No modifier groups attached"
        sub="Attach a reusable group (e.g. Milk Type, Extras) so customers can customize this item."
      />
    );
  }
  const overrideByModifierId = new Map(overrides.map((o) => [o.modifier_id, o]));
  return (
    <div className="modifier-group-list" style={{ display: 'grid', gap: 12 }}>
      {links.map((link) => {
        const g = link.modifier_group;
        const isSwap = g.type === 'SWAP';
        const activeMods = g.modifiers?.filter((m) => m.active) ?? [];
        return (
          <div key={link.id} className="card" style={{ padding: 14 }}>
            <div className="flex-between mb-8">
              <div>
                <div className="flex gap-8" style={{ alignItems: 'center' }}>
                  <span className="fw-600 fs-13">{g.name}</span>
                  {isSwap ? (
                    <Badge tone="blue">SWAP</Badge>
                  ) : (
                    <Badge tone="gray">ADD</Badge>
                  )}
                  {g.required && <Badge tone="gold">Required</Badge>}
                </div>
                <div
                  className="fs-11 text-muted mt-4 flex gap-8"
                  style={{ alignItems: 'center' }}
                >
                  <span>min {g.min_selection}</span>
                  <span>·</span>
                  <span>max {g.max_selection}</span>
                  {isSwap && (() => {
                    const def = g.modifiers?.find((m) => m.is_default);
                    return def ? (
                      <>
                        <span>·</span>
                        <span>
                          Default:{' '}
                          <span className="fw-600">{def.name}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span>·</span>
                        <span className="text-red">No default set</span>
                      </>
                    );
                  })()}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onDetach(link)}
                disabled={detaching}
                aria-label="Detach group"
              >
                Detach
              </button>
            </div>

            {activeMods.length === 0 ? (
              <span className="fs-12 text-muted">No modifiers in this group.</span>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {activeMods.map((m) => {
                  const override = overrideByModifierId.get(m.id);
                  return (
                    <div
                      key={m.id}
                      className="flex-between"
                      style={{
                        padding: '8px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        background: 'var(--bg)',
                        gap: 12,
                      }}
                    >
                      <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="fw-600 fs-13">{m.name}</span>
                        {Number(m.extra_price) > 0 && (
                          <span className="fs-12 gold">+{formatMoney(m.extra_price)}</span>
                        )}
                        {isSwap ? (
                          <span className="fs-12 text-muted">
                            ratio{' '}
                            <span className="fw-600">
                              {Number(m.ratio ?? 1).toFixed(2)}×
                            </span>
                          </span>
                        ) : m.supply_quantity ? (
                          <span className="fs-12 text-muted">
                            {Number(m.supply_quantity)} {m.supply_unit ?? ''}{' '}
                            {m.supply && <>of {m.supply.name}</>}
                          </span>
                        ) : null}
                        {override && (
                          <Badge tone="gold">
                            Custom:{' '}
                            {override.override_type === 'RATIO'
                              ? `${Number(override.override_ratio ?? 0).toFixed(2)}×`
                              : `${Number(override.override_quantity ?? 0)} ${override.override_unit ?? ''}`}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-4">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onOverride(m, g.type, override)}
                        >
                          {override ? 'Edit override' : '+ Override'}
                        </button>
                        {override && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => onDeleteOverride(m)}
                            aria-label="Remove override"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
