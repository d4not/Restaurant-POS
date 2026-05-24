// The editable header card on ProductDetailView. Purely presentational — the
// parent owns `form`, `setField`, and the field-level errors. We render the
// fields appropriate to `type`: PREPARATION hides category/price/tax/icon/
// image/sold-by-weight since the backend rejects them for that type.
//
// Designed to also host the "fields" step of ProductNewView (Phase 4), but
// the create flow re-implements its own fields inline since the wizard needs
// slightly different framing (no active toggle, optional supply link for
// PRODUCT, etc.). Kept independent so changes to one don't ripple into the
// other.

import type { CSSProperties } from 'react';
import { useTranslation } from '../../../../i18n';
import type { ProductCategory } from '../../../../api/product-categories';
import type { Tax } from '../../../../api/taxes';
import type { ProductType } from '../../../../api/products';

export interface HeaderFormState {
  name: string;
  category_id: string;
  sell_price: string;
  barcode: string;
  /** '' means "use the default tax from settings" (persisted as null). */
  tax_id: string;
  icon_color: string;
  image_url: string;
  sold_by_weight: boolean;
  allow_discount: boolean;
  active: boolean;
}

interface Props {
  form: HeaderFormState;
  setField: <K extends keyof HeaderFormState>(
    key: K,
    value: HeaderFormState[K],
  ) => void;
  type: ProductType;
  variantCount: number;
  categories: ProductCategory[];
  categoriesLoading: boolean;
  taxes: Tax[];
  taxesLoading: boolean;
  defaultTaxId: string | null;
  fieldErrors: Record<string, string>;
  saveError: string | null;
}

export function ProductHeaderForm({
  form,
  setField,
  type,
  variantCount,
  categories,
  categoriesLoading,
  taxes,
  taxesLoading,
  defaultTaxId,
  fieldErrors,
  saveError,
}: Props) {
  const { t } = useTranslation();
  const isPrep = type === 'PREPARATION';

  // The tax dropdown's first option is "Default (<resolved tax>)" — meaning
  // tax_id=null, defer to the system setting. Selecting an explicit tax
  // overrides for this product only.
  const defaultTax = defaultTaxId ? taxes.find((x) => x.id === defaultTaxId) : null;
  const defaultLabel = defaultTax
    ? `${t('admin.productDetail.field.taxDefaultPrefix')} (${defaultTax.name} — ${Number(defaultTax.rate).toFixed(2)}%)`
    : t('admin.productDetail.field.taxDefaultNone');

  return (
    <div style={card}>
      {saveError && <div style={errorBanner}>{saveError}</div>}

      {/* Product name — bigger, heading-like input */}
      <label style={fieldShell}>
        <span style={fieldLabel}>{t('admin.productDetail.field.name')}</span>
        <input
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          maxLength={200}
          placeholder={t('admin.productDetail.field.namePlaceholder')}
          required
          style={nameInput}
        />
        {fieldErrors.name && <span style={inlineError}>{fieldErrors.name}</span>}
      </label>

      <div style={grid}>
        {!isPrep && (
          <label style={fieldShell}>
            <span style={fieldLabel}>{t('admin.productDetail.field.category')}</span>
            <select
              value={form.category_id}
              onChange={(e) => setField('category_id', e.target.value)}
              disabled={categoriesLoading}
              style={textInput}
            >
              <option value="">{t('admin.productDetail.field.categoryNone')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}

        {!isPrep && (
          <label style={fieldShell}>
            <span style={fieldLabel}>{t('admin.productDetail.field.sellPrice')}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={form.sell_price}
              onChange={(e) => setField('sell_price', e.target.value)}
              placeholder={variantCount > 0 ? t('admin.productDetail.field.sellPriceByVariant') : '0.00'}
              style={textInput}
            />
            {fieldErrors.sell_price ? (
              <span style={inlineError}>{fieldErrors.sell_price}</span>
            ) : variantCount > 0 ? (
              <span style={fieldHint}>{t('admin.productDetail.field.sellPriceVariantHint')}</span>
            ) : null}
          </label>
        )}

        <label style={fieldShell}>
          <span style={fieldLabel}>{t('admin.productDetail.field.barcode')}</span>
          <input
            value={form.barcode}
            onChange={(e) => setField('barcode', e.target.value)}
            maxLength={64}
            placeholder={t('admin.productDetail.field.barcodePlaceholder')}
            style={{ ...textInput, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', letterSpacing: '0.04em' }}
          />
        </label>

        {!isPrep && (
          <label style={fieldShell}>
            <span style={fieldLabel}>{t('admin.productDetail.field.tax')}</span>
            <select
              value={form.tax_id}
              onChange={(e) => setField('tax_id', e.target.value)}
              disabled={taxesLoading}
              style={textInput}
            >
              <option value="">{defaultLabel}</option>
              {taxes.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {tx.name} — {Number(tx.rate).toFixed(2)}%
                </option>
              ))}
            </select>
            <span style={fieldHint}>{t('admin.productDetail.field.taxHint')}</span>
          </label>
        )}

        {!isPrep && (
          <label style={fieldShell}>
            <span style={fieldLabel}>{t('admin.productDetail.field.iconColor')}</span>
            <div style={iconColorRow}>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(form.icon_color) ? form.icon_color : '#c8922a'}
                onChange={(e) => setField('icon_color', e.target.value)}
                style={iconColorSwatch}
                aria-label={t('admin.productDetail.field.iconColorPick')}
              />
              <input
                value={form.icon_color}
                onChange={(e) => setField('icon_color', e.target.value)}
                placeholder="#c8922a"
                maxLength={7}
                style={{ ...textInput, flex: 1 }}
              />
            </div>
            {fieldErrors.icon_color && <span style={inlineError}>{fieldErrors.icon_color}</span>}
          </label>
        )}

        {!isPrep && (
          <label style={fieldShell}>
            <span style={fieldLabel}>{t('admin.productDetail.field.imageUrl')}</span>
            <input
              value={form.image_url}
              onChange={(e) => setField('image_url', e.target.value)}
              maxLength={500}
              placeholder="https://…"
              style={textInput}
            />
            <span style={fieldHint}>{t('admin.productDetail.field.imageUrlHint')}</span>
            {fieldErrors.image_url && <span style={inlineError}>{fieldErrors.image_url}</span>}
          </label>
        )}
      </div>

      <div style={toggleRow}>
        {!isPrep && (
          <label style={toggleItem}>
            <input
              type="checkbox"
              checked={form.sold_by_weight}
              onChange={(e) => setField('sold_by_weight', e.target.checked)}
            />
            <span>{t('admin.productDetail.field.soldByWeight')}</span>
          </label>
        )}
        <label style={toggleItem}>
          <input
            type="checkbox"
            checked={form.allow_discount}
            onChange={(e) => setField('allow_discount', e.target.checked)}
          />
          <span>{t('admin.productDetail.field.allowDiscount')}</span>
        </label>
        <label style={toggleItem}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setField('active', e.target.checked)}
          />
          <span>{t('admin.productDetail.field.active')}</span>
        </label>
      </div>
    </div>
  );
}

/* ── Styles ────────────────────────────────────────────────── */

const card: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 22,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const errorBanner: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'rgba(196,80,64,0.08)',
  color: 'var(--red)',
  fontSize: 13,
};

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 14,
};

const fieldShell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
};

const fieldLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const fieldHint: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  lineHeight: 1.4,
};

const inlineError: CSSProperties = {
  fontSize: 12,
  color: 'var(--red)',
  fontWeight: 500,
};

const nameInput: CSSProperties = {
  width: '100%',
  height: 46,
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  padding: '0 14px',
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--text1)',
  outline: 'none',
  letterSpacing: '-0.005em',
};

const textInput: CSSProperties = {
  width: '100%',
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 12px',
  fontSize: 14,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const iconColorRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const iconColorSwatch: CSSProperties = {
  width: 38,
  height: 38,
  padding: 2,
  border: '1px solid var(--border)',
  borderRadius: 8,
  cursor: 'pointer',
  background: 'var(--bg2)',
};

const toggleRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 22,
  paddingTop: 4,
};

const toggleItem: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--text1)',
  cursor: 'pointer',
};
