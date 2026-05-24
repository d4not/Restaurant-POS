// Catalog · Product detail — full-screen editor for one product.
//
// Replaces the right-side drawer of the previous draft. Lives inside the
// admin-mode shell (AdminViewShell) so Back / Esc returns to the list. Header
// form + variants are the Phase-1 surface; modifier groups, modifications and
// the recipe editor are slotted in by later phases (placeholder hooks below).
//
// Backend touch points
//   GET    /api/v1/products/:id                   — load detail
//   PATCH  /api/v1/products/:id                   — header edits
//   DELETE /api/v1/products/:id                   — soft-delete
//   POST   /api/v1/products/:id/variants          — add variant (via modal)
//   PATCH  /api/v1/products/:id/variants/:vId     — edit variant (via modal)
//   DELETE /api/v1/products/:id/variants/:vId     — delete variant

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import { ApiError } from '../../../api/client';
import { fetchSettings } from '../../../api/settings';
import {
  useDeleteProduct,
  useDeleteVariant,
  useDetachModifierGroup,
  useDuplicateProduct,
  useProduct,
  useProductCategories,
  useTaxes,
  useUpdateProduct,
} from '../../../hooks/useProducts';
import {
  useDeleteOverride,
  useModifierOverrides,
} from '../../../hooks/useModifierOverrides';
import {
  useDeleteModification,
  useProductModifications,
} from '../../../hooks/useProductModifications';
import {
  type Modifier,
  type ModifierGroupType,
  type ModifierProductOverride,
  type PosProduct,
  type ProductModification,
  type ProductModifierGroupLink,
  type ProductVariant,
  type UpdateProductInput,
} from '../../../api/products';
import { formatMoney, formatNumber, formatPct } from '../../../utils/format';
import {
  foodCostColor,
  productTypeBadgeStyle,
  productTypeLabel,
} from '../../../utils/product-meta';
import { SaveBar } from './productDetail/SaveBar';
import {
  ProductHeaderForm,
  type HeaderFormState,
} from './productDetail/ProductHeaderForm';
import { VariantFormModal } from './productDetail/VariantFormModal';
import { ModifierGroupCard } from './productDetail/ModifierGroupCard';
import { AttachModifierGroupModal } from './productDetail/AttachModifierGroupModal';
import { OverrideFormModal } from './productDetail/OverrideFormModal';
import { ModificationFormModal } from './productDetail/ModificationFormModal';
import { RecipeEditor } from './productDetail/RecipeEditor';

interface Props {
  productId: string;
  onBack: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
  onDuplicated?: (newId: string) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function buildFormState(p: PosProduct): HeaderFormState {
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

function lowestVariantPrice(variants: ProductVariant[]): number | null {
  let lo: number | null = null;
  for (const v of variants) {
    if (!v.active) continue;
    const n = Number(v.sell_price);
    if (!Number.isFinite(n)) continue;
    if (lo === null || n < lo) lo = n;
  }
  return lo;
}

function highestVariantPrice(variants: ProductVariant[]): number | null {
  let hi: number | null = null;
  for (const v of variants) {
    if (!v.active) continue;
    const n = Number(v.sell_price);
    if (!Number.isFinite(n)) continue;
    if (hi === null || n > hi) hi = n;
  }
  return hi;
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function ProductDetailView({ productId, onBack, onSaved, onError, onDuplicated }: Props) {
  const { t } = useTranslation();
  const productQ = useProduct(productId);
  const categoriesQ = useProductCategories();
  const taxesQ = useTaxes({ active: true });
  const settingsQ = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: fetchSettings,
    staleTime: 5 * 60_000,
  });

  const product = productQ.data ?? null;

  /* ── Form state (header) ─────────────────────────────────────────── */
  // Resetting on `product.id` change (or first arrival) keeps unsaved edits
  // alive across background refetches of the same product.
  const [form, setForm] = useState<HeaderFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  // Bumps after every successful save so `form` resets to the freshly
  // fetched product (and not before — otherwise unsaved edits would vanish on
  // unrelated catalog refetches).
  const [resyncToken, setResyncToken] = useState(0);

  useEffect(() => {
    if (!product) return;
    setForm(buildFormState(product));
    setFieldErrors({});
    setSaveError(null);
    // Only re-key on product.id change or explicit re-sync after save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, resyncToken]);

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

  /* ── Mutations ───────────────────────────────────────────────────── */

  const updateMut = useUpdateProduct();
  const deleteMut = useDeleteProduct();
  const duplicateMut = useDuplicateProduct();
  const deleteVariantMut = useDeleteVariant(productId);
  const detachGroupMut = useDetachModifierGroup(productId);
  const deleteOverrideMut = useDeleteOverride(productId);
  const deleteModificationMut = useDeleteModification(productId);

  const overridesQ = useModifierOverrides(productId);
  const modificationsQ = useProductModifications(productId, {
    enabled: product?.type === 'PRODUCT',
  });

  const onDiscard = () => {
    if (!product) return;
    setForm(buildFormState(product));
    setFieldErrors({});
    setSaveError(null);
  };

  const onSave = async () => {
    if (!product || !form) return;
    const isPrep = product.type === 'PREPARATION';
    const errors: Record<string, string> = {};
    if (!form.name.trim()) {
      errors.name = t('admin.productDetail.validation.nameRequired');
    }
    if (!isPrep && form.sell_price.trim()) {
      const n = Number(form.sell_price);
      if (!Number.isFinite(n) || n < 0) {
        errors.sell_price = t(
          'admin.productDetail.validation.sellPriceNonNegative',
        );
      }
    }
    if (
      !isPrep &&
      form.icon_color.trim() &&
      !/^#[0-9a-fA-F]{6}$/.test(form.icon_color.trim())
    ) {
      errors.icon_color = t('admin.productDetail.validation.iconColorHex');
    }
    if (!isPrep && form.image_url.trim().length > 500) {
      errors.image_url = t('admin.productDetail.validation.imageUrlLength');
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // Only diffed fields. Preparation rows must not carry category/sell_price.
    const original = buildFormState(product);
    const payload: UpdateProductInput = {};
    if (form.name.trim() !== original.name) payload.name = form.name.trim();
    if (!isPrep && form.category_id !== original.category_id) {
      payload.category_id = form.category_id || null;
    }
    if (!isPrep && form.sell_price !== original.sell_price) {
      payload.sell_price = form.sell_price.trim()
        ? Math.round(Number(form.sell_price) * 100)
        : null;
    }
    if (form.barcode !== original.barcode) {
      payload.barcode = form.barcode.trim() || null;
    }
    if (!isPrep && form.tax_id !== original.tax_id) {
      payload.tax_id = form.tax_id || null;
    }
    if (!isPrep && form.icon_color !== original.icon_color) {
      payload.icon_color = form.icon_color.trim() || null;
    }
    if (!isPrep && form.image_url !== original.image_url) {
      payload.image_url = form.image_url.trim() || null;
    }
    if (!isPrep && form.sold_by_weight !== original.sold_by_weight) {
      payload.sold_by_weight = form.sold_by_weight;
    }
    if (form.allow_discount !== original.allow_discount) {
      payload.allow_discount = form.allow_discount;
    }
    if (form.active !== original.active) payload.active = form.active;

    if (Object.keys(payload).length === 0) {
      // Nothing changed — likely a stale dirty flag from a transient edit
      // that landed back on the original value.
      setFieldErrors({});
      return;
    }

    setSaveError(null);
    try {
      await updateMut.mutateAsync({ id: product.id, input: payload });
      setFieldErrors({});
      setResyncToken((n) => n + 1);
      onSaved(t('admin.productDetail.saveSuccess'));
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : t('admin.productDetail.saveError');
      setSaveError(msg);
    }
  };

  const onDeleteProduct = async () => {
    if (!product) return;
    if (!confirm(t('admin.productDetail.deleteConfirm').replace('{name}', product.name))) {
      return;
    }
    try {
      await deleteMut.mutateAsync(product.id);
      onSaved(t('admin.productDetail.deleteSuccess'));
      onBack();
    } catch (err) {
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.productDetail.saveError'),
      );
    }
  };

  const onDuplicateProduct = async () => {
    if (!product) return;
    if (!confirm(t('admin.productDetail.duplicateConfirm').replace('{name}', product.name))) {
      return;
    }
    try {
      const copy = await duplicateMut.mutateAsync(product.id);
      onSaved(t('admin.productDetail.duplicateSuccess'));
      onDuplicated?.(copy.id);
    } catch (err) {
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.productDetail.saveError'),
      );
    }
  };

  const onDeleteVariant = async (v: ProductVariant) => {
    if (!confirm(t('admin.productDetail.variants.deleteConfirm').replace('{name}', v.name))) {
      return;
    }
    try {
      await deleteVariantMut.mutateAsync(v.id);
      onSaved(t('admin.productDetail.variants.deleteSuccess'));
    } catch (err) {
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.productDetail.saveError'),
      );
    }
  };

  const onDetachGroup = async (link: ProductModifierGroupLink) => {
    if (
      !confirm(
        t('admin.productDetail.modifierGroups.detachConfirm').replace(
          '{name}',
          link.modifier_group.name,
        ),
      )
    ) {
      return;
    }
    try {
      await detachGroupMut.mutateAsync(link.modifier_group_id);
      onSaved(t('admin.productDetail.modifierGroups.detachSuccess'));
    } catch (err) {
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.productDetail.saveError'),
      );
    }
  };

  const onRemoveOverride = async (modifier: Modifier) => {
    if (
      !confirm(
        t('admin.productDetail.modifierGroups.overrideRemoveConfirm').replace(
          '{name}',
          modifier.name,
        ),
      )
    ) {
      return;
    }
    try {
      await deleteOverrideMut.mutateAsync(modifier.id);
      onSaved(t('admin.productDetail.modifierGroups.overrideRemoveSuccess'));
    } catch (err) {
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.productDetail.saveError'),
      );
    }
  };

  const onDeleteModification = async (m: ProductModification) => {
    if (
      !confirm(
        t('admin.productDetail.modifications.deleteConfirm').replace('{name}', m.name),
      )
    ) {
      return;
    }
    try {
      await deleteModificationMut.mutateAsync(m.id);
      onSaved(t('admin.productDetail.modifications.deleteSuccess'));
    } catch (err) {
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.productDetail.saveError'),
      );
    }
  };

  /* ── Sub-view modal state ─────────────────────────────────────────── */

  const [variantModal, setVariantModal] = useState<{
    open: boolean;
    variant: ProductVariant | null;
  }>({ open: false, variant: null });

  const [attachOpen, setAttachOpen] = useState(false);
  const [overrideModal, setOverrideModal] = useState<{
    open: boolean;
    modifier: Modifier | null;
    groupType: ModifierGroupType;
    existing: ModifierProductOverride | null;
  }>({ open: false, modifier: null, groupType: 'ADD', existing: null });
  const [modificationModal, setModificationModal] = useState<{
    open: boolean;
    modification: ProductModification | null;
  }>({ open: false, modification: null });

  // Recipe section — variant pill picker state. Reset whenever the variant
  // list shape changes so we always have a valid id selected.
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

  /* ── Render ──────────────────────────────────────────────────────── */

  if (productQ.isLoading) {
    return (
      <AdminViewShell titleKey="admin.productDetail.title" onBack={onBack}>
        <div style={spinnerWrap}>
          <Spinner />
        </div>
      </AdminViewShell>
    );
  }

  if (productQ.error || !product) {
    return (
      <AdminViewShell titleKey="admin.productDetail.title" onBack={onBack}>
        <div style={emptyWrap}>
          <p style={emptyTitle}>{t('admin.productDetail.loadError')}</p>
          <p style={emptyHint}>
            {(productQ.error as Error | null)?.message ??
              t('admin.productDetail.loadErrorHint')}
          </p>
        </div>
      </AdminViewShell>
    );
  }

  const isDish = product.type === 'DISH';
  const variants = product.variants;
  const variantCount = variants.length;

  const priceDisplay = (() => {
    if (variants.length > 0) {
      const lo = lowestVariantPrice(variants);
      const hi = highestVariantPrice(variants);
      if (lo === null || hi === null) return '—';
      if (lo === hi) return formatMoney(lo);
      return `${formatMoney(lo)} – ${formatMoney(hi)}`;
    }
    return product.sell_price ? formatMoney(product.sell_price) : '—';
  })();

  const recipeCostNum = Number(product.recipe_cost);
  const foodPctNum = Number(product.food_cost_pct);
  const markupNum = Number(product.markup);
  const defaultTaxId = settingsQ.data?.default_tax_id ?? null;

  return (
    <AdminViewShell
      titleKey="admin.productDetail.title"
      onBack={onBack}
      headerActions={
        <span style={typePillAndStatus}>
          <span style={{ ...typeBadge, ...productTypeBadgeStyle(product.type) }}>
            {productTypeLabel(product.type)}
          </span>
          <span style={{ ...statusBadge, ...(product.active ? statusOk : statusOff) }}>
            {product.active
              ? t('admin.productDetail.status.active')
              : t('admin.productDetail.status.inactive')}
          </span>
        </span>
      }
    >
      {/* SaveBar — appears only when form is dirty */}
      {isDirty && form && (
        <SaveBar saving={updateMut.isPending} onDiscard={onDiscard} onSave={onSave} />
      )}

      {/* Header card (inline edit) + action button row */}
      <div style={topRow}>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          style={btnGhost}
          onClick={onDuplicateProduct}
          disabled={duplicateMut.isPending || updateMut.isPending}
        >
          {t('admin.productDetail.duplicate')}
        </button>
        <button
          type="button"
          style={btnDanger}
          onClick={onDeleteProduct}
          disabled={deleteMut.isPending || updateMut.isPending}
        >
          {t('admin.productDetail.delete')}
        </button>
      </div>

      {form && (
        <ProductHeaderForm
          form={form}
          setField={setField}
          type={product.type}
          variantCount={variantCount}
          categories={categoriesQ.data ?? []}
          categoriesLoading={categoriesQ.isLoading}
          taxes={taxesQ.data ?? []}
          taxesLoading={taxesQ.isLoading}
          defaultTaxId={defaultTaxId}
          fieldErrors={fieldErrors}
          saveError={saveError}
        />
      )}

      {/* KPI strip */}
      <div style={kpiGrid}>
        <Kpi
          label={t('admin.productDetail.kpi.price')}
          value={priceDisplay}
          hint={
            variantCount > 0
              ? t('admin.productDetail.kpi.priceVariantsHint').replace(
                  '{count}',
                  String(variantCount),
                )
              : undefined
          }
        />
        <Kpi
          label={t('admin.productDetail.kpi.recipeCost')}
          value={recipeCostNum > 0 ? formatMoney(recipeCostNum) : '—'}
          hint={t('admin.productDetail.kpi.recipeCostHint')}
        />
        <Kpi
          label={t('admin.productDetail.kpi.foodCostPct')}
          value={foodPctNum > 0 ? formatPct(foodPctNum) : '—'}
          valueColor={foodPctNum > 0 ? foodCostColor(foodPctNum) : undefined}
          hint={t('admin.productDetail.kpi.foodCostPctHint')}
        />
        <Kpi
          label={t('admin.productDetail.kpi.markup')}
          value={markupNum > 0 ? `${formatNumber(markupNum, 2)}×` : '—'}
          hint={t('admin.productDetail.kpi.markupHint')}
        />
      </div>

      {/* Variants section — DISH only */}
      {isDish && (
        <section style={section}>
          <div style={sectionHead}>
            <h3 style={sectionTitle}>
              {t('admin.productDetail.variants.title')}
            </h3>
            <button
              type="button"
              style={btnPrimarySm}
              onClick={() => setVariantModal({ open: true, variant: null })}
            >
              {t('admin.productDetail.variants.addBtn')}
            </button>
          </div>

          <div style={tableShell}>
            <div style={{ ...tableHead, gridTemplateColumns: VARIANT_COLS }}>
              <span>{t('admin.productDetail.variants.col.name')}</span>
              <span style={cellNumHead}>
                {t('admin.productDetail.variants.col.price')}
              </span>
              <span style={cellNumHead}>
                {t('admin.productDetail.variants.col.recipeCost')}
              </span>
              <span style={cellNumHead}>
                {t('admin.productDetail.variants.col.foodCost')}
              </span>
              <span>{t('admin.productDetail.variants.col.status')}</span>
              <span />
            </div>

            {variants.length === 0 ? (
              <div style={emptyRow}>
                <p style={emptyTitle}>{t('admin.productDetail.variants.empty')}</p>
                <p style={emptyHint}>
                  {t('admin.productDetail.variants.emptyHint')}
                </p>
              </div>
            ) : (
              variants.map((v) => {
                const vRecipe = Number(v.recipe_cost);
                const vFood = Number(v.food_cost_pct);
                return (
                  <div
                    key={v.id}
                    style={{ ...tableRow, gridTemplateColumns: VARIANT_COLS }}
                  >
                    <span style={nameCell}>
                      <span style={nameMain}>{v.name}</span>
                      {v.barcode && <span style={nameSub}>{v.barcode}</span>}
                    </span>
                    <span style={cellNum}>{formatMoney(v.sell_price)}</span>
                    <span style={{ ...cellNum, color: 'var(--text2)' }}>
                      {vRecipe > 0 ? formatMoney(vRecipe) : '—'}
                    </span>
                    <span
                      style={{
                        ...cellNum,
                        color: vFood > 0 ? foodCostColor(vFood) : 'var(--text3)',
                        fontWeight: 600,
                      }}
                    >
                      {vFood > 0 ? formatPct(vFood) : '—'}
                    </span>
                    <span>
                      <span
                        style={{
                          ...statusBadge,
                          ...(v.active ? statusOk : statusOff),
                        }}
                      >
                        {v.active
                          ? t('admin.productDetail.status.active')
                          : t('admin.productDetail.status.inactive')}
                      </span>
                    </span>
                    <span style={actionsCell}>
                      <button
                        type="button"
                        style={btnGhostSm}
                        onClick={() => setVariantModal({ open: true, variant: v })}
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        style={btnGhostSm}
                        onClick={() => onDeleteVariant(v)}
                        disabled={deleteVariantMut.isPending}
                        aria-label={t('common.delete')}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* Modifier groups section — DISH + PRODUCT */}
      {product.type !== 'PREPARATION' && (
        <section style={section}>
          <div style={sectionHead}>
            <h3 style={sectionTitle}>
              {t('admin.productDetail.modifierGroups.title')}
            </h3>
            <button
              type="button"
              style={btnPrimarySm}
              onClick={() => setAttachOpen(true)}
            >
              {t('admin.productDetail.modifierGroups.attachBtn')}
            </button>
          </div>

          {product.modifier_groups.length === 0 ? (
            <div style={tableShell}>
              <div style={emptyRow}>
                <p style={emptyTitle}>
                  {t('admin.productDetail.modifierGroups.empty')}
                </p>
                <p style={emptyHint}>
                  {t('admin.productDetail.modifierGroups.emptyHint')}
                </p>
              </div>
            </div>
          ) : (
            <div style={cardStack}>
              {product.modifier_groups.map((link) => (
                <ModifierGroupCard
                  key={link.id}
                  link={link}
                  overrides={overridesQ.data ?? []}
                  onDetach={onDetachGroup}
                  detaching={detachGroupMut.isPending}
                  onOverride={(modifier, groupType, existing) =>
                    setOverrideModal({
                      open: true,
                      modifier,
                      groupType,
                      existing,
                    })
                  }
                  onDeleteOverride={onRemoveOverride}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Modifications section — PRODUCT only */}
      {product.type === 'PRODUCT' && (
        <section style={section}>
          <div style={sectionHead}>
            <h3 style={sectionTitle}>
              {t('admin.productDetail.modifications.title')}
            </h3>
            <button
              type="button"
              style={btnPrimarySm}
              onClick={() =>
                setModificationModal({ open: true, modification: null })
              }
            >
              {t('admin.productDetail.modifications.addBtn')}
            </button>
          </div>

          <div style={tableShell}>
            <div style={{ ...tableHead, gridTemplateColumns: MODIFICATION_COLS }}>
              <span>{t('admin.productDetail.modifications.col.name')}</span>
              <span style={cellNumHead}>
                {t('admin.productDetail.modifications.col.price')}
              </span>
              <span>{t('admin.productDetail.modifications.col.supply')}</span>
              <span>{t('admin.productDetail.modifications.col.status')}</span>
              <span />
            </div>

            {modificationsQ.isLoading ? (
              <div style={spinnerWrap}>
                <Spinner />
              </div>
            ) : (modificationsQ.data?.length ?? 0) === 0 ? (
              <div style={emptyRow}>
                <p style={emptyTitle}>
                  {t('admin.productDetail.modifications.empty')}
                </p>
                <p style={emptyHint}>
                  {t('admin.productDetail.modifications.emptyHint')}
                </p>
              </div>
            ) : (
              (modificationsQ.data ?? []).map((m) => (
                <div
                  key={m.id}
                  style={{ ...tableRow, gridTemplateColumns: MODIFICATION_COLS }}
                >
                  <span style={nameCell}>
                    <span style={nameMain}>{m.name}</span>
                    {m.barcode && <span style={nameSub}>{m.barcode}</span>}
                  </span>
                  <span style={cellNum}>{formatMoney(m.sell_price)}</span>
                  <span style={{ color: 'var(--text2)', fontSize: 12 }}>
                    {m.supply?.name ?? '—'}
                  </span>
                  <span>
                    <span
                      style={{
                        ...statusBadge,
                        ...(m.active ? statusOk : statusOff),
                      }}
                    >
                      {m.active
                        ? t('admin.productDetail.status.active')
                        : t('admin.productDetail.status.inactive')}
                    </span>
                  </span>
                  <span style={actionsCell}>
                    <button
                      type="button"
                      style={btnGhostSm}
                      onClick={() =>
                        setModificationModal({ open: true, modification: m })
                      }
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      style={btnGhostSm}
                      onClick={() => onDeleteModification(m)}
                      disabled={deleteModificationMut.isPending}
                      aria-label={t('common.delete')}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Recipe section — DISH (per-product or per-variant) and PREPARATION */}
      {(product.type === 'DISH' || product.type === 'PREPARATION') && (
        <section style={section}>
          <div style={sectionHead}>
            <h3 style={sectionTitle}>
              {t('admin.productDetail.recipe.title')}
              {product.type === 'DISH' && variants.length > 0 && (
                <span style={recipeHeadNote}>
                  {' '}
                  {t('admin.productDetail.recipe.perVariantNote')}
                </span>
              )}
            </h3>
          </div>

          {/* Variant picker (DISH + variants) */}
          {product.type === 'DISH' && variants.length > 0 && (
            <div style={variantPillRow}>
              {variants.map((v) => {
                const effective =
                  activeVariantId && variants.some((x) => x.id === activeVariantId)
                    ? activeVariantId
                    : variants[0].id;
                const isActive = effective === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    style={{
                      ...variantPill,
                      ...(isActive ? variantPillActive : {}),
                    }}
                    onClick={() => setActiveVariantId(v.id)}
                  >
                    {v.name}
                  </button>
                );
              })}
            </div>
          )}

          {(() => {
            if (product.type === 'PREPARATION') {
              return (
                <RecipeEditor
                  key={`prep-${product.id}`}
                  owner={{ kind: 'product', id: product.id }}
                  requiresYield
                  cachedCost={product.recipe_cost}
                />
              );
            }
            // DISH without variants → product-level recipe
            if (variants.length === 0) {
              return (
                <RecipeEditor
                  key={`dish-${product.id}`}
                  owner={{ kind: 'product', id: product.id }}
                  requiresYield={false}
                  cachedCost={product.recipe_cost}
                  sellPrice={product.sell_price}
                />
              );
            }
            // DISH with variants → variant-level recipe (keyed so it remounts cleanly)
            const effectiveId =
              activeVariantId && variants.some((v) => v.id === activeVariantId)
                ? activeVariantId
                : variants[0].id;
            const active = variants.find((v) => v.id === effectiveId);
            if (!active) return null;
            return (
              <RecipeEditor
                key={active.id}
                owner={{ kind: 'variant', id: active.id }}
                requiresYield={false}
                cachedCost={active.recipe_cost}
                sellPrice={active.sell_price}
              />
            );
          })()}
        </section>
      )}

      <VariantFormModal
        open={variantModal.open}
        onClose={() => setVariantModal({ open: false, variant: null })}
        productId={product.id}
        variant={variantModal.variant}
        onSaved={() => onSaved(t('admin.productDetail.variants.saveSuccess'))}
        onError={onError}
      />

      <AttachModifierGroupModal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        productId={product.id}
        attachedIds={product.modifier_groups.map((l) => l.modifier_group_id)}
        onAttached={(msg) => onSaved(msg)}
        onError={onError}
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
        onSaved={(msg) => onSaved(msg)}
        onError={onError}
      />

      <ModificationFormModal
        open={modificationModal.open}
        onClose={() => setModificationModal({ open: false, modification: null })}
        productId={product.id}
        modification={modificationModal.modification}
        onSaved={(msg) => onSaved(msg)}
        onError={onError}
      />
    </AdminViewShell>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  valueColor?: string;
}

function Kpi({ label, value, hint, valueColor }: KpiProps) {
  return (
    <div style={kpiCellStyle}>
      <span style={kpiLabelStyle}>{label}</span>
      <span style={{ ...kpiValueStyle, ...(valueColor ? { color: valueColor } : {}) }}>
        {value}
      </span>
      {hint && <span style={kpiHintStyle}>{hint}</span>}
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const VARIANT_COLS =
  'minmax(220px, 2.2fr) 120px 120px 100px 90px 130px';

const MODIFICATION_COLS =
  'minmax(220px, 2.2fr) 120px minmax(140px, 1.3fr) 90px 130px';

const cardStack: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const recipeHeadNote: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  fontFamily: 'inherit',
  fontWeight: 400,
  marginLeft: 8,
};

const variantPillRow: CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 12,
};

const variantPill: CSSProperties = {
  padding: '6px 13px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const variantPillActive: CSSProperties = {
  background: 'var(--text1)',
  color: '#fff',
  borderColor: 'var(--text1)',
};

const spinnerWrap: CSSProperties = {
  padding: 48,
  display: 'flex',
  justifyContent: 'center',
};

const emptyWrap: CSSProperties = {
  padding: '64px 24px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'center',
};

const emptyTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  color: 'var(--text2)',
  margin: 0,
};

const emptyHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  margin: 0,
};

const typePillAndStatus: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const typeBadge: CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const statusOk: CSSProperties = {
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
  border: '1px solid rgba(74,140,92,0.30)',
};

const statusOff: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const topRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginBottom: 10,
};

const btnGhost: CSSProperties = {
  padding: '0 16px',
  height: 38,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnDanger: CSSProperties = {
  padding: '0 16px',
  height: 38,
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const kpiGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 14,
  marginTop: 16,
  marginBottom: 20,
};

const kpiCellStyle: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '14px 18px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const kpiLabelStyle: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const kpiValueStyle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 24,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.1,
  letterSpacing: '-0.005em',
};

const kpiHintStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  marginTop: 2,
};

const section: CSSProperties = {
  marginTop: 14,
  marginBottom: 18,
};

const sectionHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 10,
  gap: 12,
};

const sectionTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 17,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const btnPrimarySm: CSSProperties = {
  padding: '0 14px',
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnGhostSm: CSSProperties = {
  padding: '0 10px',
  height: 30,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const tableShell: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '12px 20px',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  gap: 14,
  alignItems: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  padding: '12px 20px',
  borderTop: '1px solid var(--border)',
  gap: 14,
  alignItems: 'center',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 48,
};

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: "'Playfair Display', serif",
  fontWeight: 600,
  fontSize: 14,
};

const cellNumHead: CSSProperties = {
  textAlign: 'right',
};

const nameCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const nameMain: CSSProperties = {
  fontWeight: 600,
  color: 'var(--text1)',
  fontSize: 13.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const nameSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  letterSpacing: '0.04em',
};

const actionsCell: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
};

const emptyRow: CSSProperties = {
  padding: '36px 20px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  alignItems: 'center',
};
