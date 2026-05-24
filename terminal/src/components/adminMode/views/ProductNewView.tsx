// Catalog · Product wizard — full-screen creation flow.
//
// Two steps. Step 1: pick a type (PRODUCT / DISH / PREPARATION) — each option
// shows a one-line hint so the operator understands the consequence. Step 2:
// fill the fields appropriate to that type. On success, the parent dispatcher
// pushes the freshly-created product into the detail view so variants /
// modifiers / recipe can be added next.
//
// Backend touch points
//   POST /api/v1/products            — creation (Zod-validated)

import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import { IconChevronLeft } from '../../Icons';
import { useTranslation } from '../../../i18n';
import { ApiError } from '../../../api/client';
import { fetchSettings } from '../../../api/settings';
import {
  PRODUCT_TYPES,
  type CreateProductInput,
  type ProductType,
} from '../../../api/products';
import {
  useCreateProduct,
  useProductCategories,
  useTaxes,
} from '../../../hooks/useProducts';
import {
  productTypeBadgeStyle,
  productTypeHint,
  productTypeLabel,
} from '../../../utils/product-meta';

interface Props {
  onBack: () => void;
  onCreated: (productId: string, msg: string) => void;
  onError: (msg: string) => void;
}

type Step = 'type' | 'fields';

interface FormState {
  type: ProductType | '';
  name: string;
  category_id: string;
  sell_price: string;
  barcode: string;
  tax_id: string;
  icon_color: string;
  image_url: string;
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
  tax_id: '',
  icon_color: '',
  image_url: '',
  sold_by_weight: false,
  allow_discount: true,
  active: true,
};

export function ProductNewView({ onBack, onCreated, onError }: Props) {
  const { t } = useTranslation();

  const [step, setStep] = useState<Step>('type');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const categoriesQ = useProductCategories();
  const taxesQ = useTaxes({ active: true });
  const settingsQ = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: fetchSettings,
    staleTime: 5 * 60_000,
  });
  const createMut = useCreateProduct();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
    setServerError(null);
  };

  const defaultTaxId = settingsQ.data?.default_tax_id ?? null;
  const taxes = taxesQ.data ?? [];
  const defaultTax = defaultTaxId ? taxes.find((x) => x.id === defaultTaxId) : null;
  const defaultLabel = defaultTax
    ? `${t('admin.productDetail.field.taxDefaultPrefix')} (${defaultTax.name} — ${Number(defaultTax.rate).toFixed(2)}%)`
    : t('admin.productDetail.field.taxDefaultNone');

  const isPrep = form.type === 'PREPARATION';

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.type) e.type = t('admin.productNew.validation.typeRequired');
    if (!form.name.trim()) {
      e.name = t('admin.productDetail.validation.nameRequired');
    }
    if (!isPrep && form.sell_price.trim()) {
      const n = Number(form.sell_price);
      if (!Number.isFinite(n) || n < 0) {
        e.sell_price = t('admin.productDetail.validation.sellPriceNonNegative');
      }
    }
    if (
      !isPrep &&
      form.icon_color.trim() &&
      !/^#[0-9a-fA-F]{6}$/.test(form.icon_color.trim())
    ) {
      e.icon_color = t('admin.productDetail.validation.iconColorHex');
    }
    if (!isPrep && form.image_url.trim().length > 500) {
      e.image_url = t('admin.productDetail.validation.imageUrlLength');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setServerError(null);

    const sellPrice = form.sell_price.trim()
      ? Math.round(Number(form.sell_price) * 100)
      : null;

    const payload: CreateProductInput = {
      type: form.type as ProductType,
      name: form.name.trim(),
      category_id: isPrep ? null : form.category_id || null,
      sell_price: isPrep ? null : sellPrice,
      barcode: form.barcode.trim() || null,
      tax_id: isPrep ? null : form.tax_id || null,
      icon_color: isPrep ? null : form.icon_color.trim() || null,
      image_url: isPrep ? null : form.image_url.trim() || null,
      sold_by_weight: isPrep ? false : form.sold_by_weight,
      allow_discount: form.allow_discount,
      active: form.active,
    };

    try {
      const created = await createMut.mutateAsync(payload);
      onCreated(created.id, t('admin.productNew.created'));
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : t('admin.productDetail.saveError');
      setServerError(msg);
      onError(msg);
    }
  };

  const taxOptions = useMemo(
    () => taxes.map((tx) => ({ id: tx.id, label: `${tx.name} — ${Number(tx.rate).toFixed(2)}%` })),
    [taxes],
  );

  /* ── Step 1 — type picker ─────────────────────────────────────── */

  if (step === 'type') {
    return (
      <AdminViewShell
        titleKey="admin.productNew.title"
        subtitleKey="admin.productNew.subtitle"
        onBack={onBack}
      >
        <p style={intro}>{t('admin.productNew.typePicker.intro')}</p>
        <div style={typeGrid}>
          {PRODUCT_TYPES.map((tp) => (
            <button
              key={tp}
              type="button"
              style={typeCard}
              onClick={() => {
                set('type', tp);
                setStep('fields');
              }}
            >
              <span style={{ ...typeBadge, ...productTypeBadgeStyle(tp) }}>
                {productTypeLabel(tp)}
              </span>
              <span style={typeHint}>{productTypeHint(tp)}</span>
            </button>
          ))}
        </div>
      </AdminViewShell>
    );
  }

  /* ── Step 2 — fields ──────────────────────────────────────────── */

  return (
    <AdminViewShell
      titleKey="admin.productNew.title"
      subtitleKey="admin.productNew.subtitle"
      onBack={onBack}
      headerActions={
        form.type ? (
          <span style={{ ...typeBadge, ...productTypeBadgeStyle(form.type as ProductType) }}>
            {productTypeLabel(form.type as ProductType)}
          </span>
        ) : undefined
      }
    >
      <form onSubmit={submit} style={formShell} noValidate>
        {form.type && (
          <div style={typeRecap}>
            {productTypeHint(form.type as ProductType)}
            <button
              type="button"
              style={typeBackLink}
              onClick={() => setStep('type')}
              disabled={createMut.isPending}
            >
              <IconChevronLeft style={{ fontSize: 14 }} />
              <span>{t('admin.productNew.changeType')}</span>
            </button>
          </div>
        )}

        {serverError && <div style={errorBanner}>{serverError}</div>}

        <label style={fieldShell}>
          <span style={fieldLabel}>{t('admin.productDetail.field.name')}</span>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
            maxLength={200}
            placeholder={t('admin.productDetail.field.namePlaceholder')}
            style={nameInput}
          />
          {errors.name && <span style={inlineError}>{errors.name}</span>}
        </label>

        <div style={grid}>
          {!isPrep && (
            <label style={fieldShell}>
              <span style={fieldLabel}>{t('admin.productDetail.field.category')}</span>
              <select
                value={form.category_id}
                onChange={(e) => set('category_id', e.target.value)}
                disabled={categoriesQ.isLoading}
                style={textInput}
              >
                <option value="">{t('admin.productDetail.field.categoryNone')}</option>
                {(categoriesQ.data ?? []).map((c) => (
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
                onChange={(e) => set('sell_price', e.target.value)}
                placeholder="0.00"
                style={textInput}
              />
              <span style={fieldHint}>
                {t('admin.productNew.fields.sellPriceHint')}
              </span>
              {errors.sell_price && <span style={inlineError}>{errors.sell_price}</span>}
            </label>
          )}

          <label style={fieldShell}>
            <span style={fieldLabel}>{t('admin.productDetail.field.barcode')}</span>
            <input
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value)}
              maxLength={64}
              placeholder={t('admin.productDetail.field.barcodePlaceholder')}
              style={{ ...textInput, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' }}
            />
          </label>

          {!isPrep && (
            <label style={fieldShell}>
              <span style={fieldLabel}>{t('admin.productDetail.field.tax')}</span>
              <select
                value={form.tax_id}
                onChange={(e) => set('tax_id', e.target.value)}
                disabled={taxesQ.isLoading}
                style={textInput}
              >
                <option value="">{defaultLabel}</option>
                {taxOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
          )}

          {!isPrep && (
            <label style={fieldShell}>
              <span style={fieldLabel}>{t('admin.productDetail.field.iconColor')}</span>
              <div style={iconColorRow}>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.icon_color) ? form.icon_color : '#c8922a'}
                  onChange={(e) => set('icon_color', e.target.value)}
                  style={iconColorSwatch}
                  aria-label={t('admin.productDetail.field.iconColorPick')}
                />
                <input
                  value={form.icon_color}
                  onChange={(e) => set('icon_color', e.target.value)}
                  placeholder="#c8922a"
                  maxLength={7}
                  style={{ ...textInput, flex: 1 }}
                />
              </div>
              {errors.icon_color && <span style={inlineError}>{errors.icon_color}</span>}
            </label>
          )}

          {!isPrep && (
            <label style={fieldShell}>
              <span style={fieldLabel}>{t('admin.productDetail.field.imageUrl')}</span>
              <input
                value={form.image_url}
                onChange={(e) => set('image_url', e.target.value)}
                maxLength={500}
                placeholder="https://…"
                style={textInput}
              />
              {errors.image_url && <span style={inlineError}>{errors.image_url}</span>}
            </label>
          )}
        </div>

        <div style={toggleRow}>
          {!isPrep && (
            <label style={toggleItem}>
              <input
                type="checkbox"
                checked={form.sold_by_weight}
                onChange={(e) => set('sold_by_weight', e.target.checked)}
              />
              <span>{t('admin.productDetail.field.soldByWeight')}</span>
            </label>
          )}
          <label style={toggleItem}>
            <input
              type="checkbox"
              checked={form.allow_discount}
              onChange={(e) => set('allow_discount', e.target.checked)}
            />
            <span>{t('admin.productDetail.field.allowDiscount')}</span>
          </label>
          <label style={toggleItem}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            <span>{t('admin.productDetail.field.active')}</span>
          </label>
        </div>

        <div style={footer}>
          <button
            type="button"
            style={btnGhost}
            onClick={onBack}
            disabled={createMut.isPending}
          >
            {t('admin.productNew.cancel')}
          </button>
          <span style={{ flex: 1 }} />
          <button type="submit" style={btnPrimary} disabled={createMut.isPending}>
            {createMut.isPending ? (
              <>
                <Spinner size={14} />
                <span>{t('admin.productNew.create')}</span>
              </>
            ) : (
              <span>{t('admin.productNew.create')}</span>
            )}
          </button>
        </div>
      </form>
    </AdminViewShell>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const intro: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  marginBottom: 18,
  lineHeight: 1.5,
};

const typeGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 14,
};

const typeCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 12,
  padding: '22px 22px 20px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  color: 'var(--text1)',
  minHeight: 140,
  transition: 'transform 120ms ease-out, border-color 120ms ease-out',
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

const typeHint: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  lineHeight: 1.5,
};

const formShell: CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  paddingBottom: 32,
};

const typeRecap: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 12,
  color: 'var(--text2)',
};

const typeBackLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 6,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const errorBanner: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'rgba(196,80,64,0.08)',
  color: 'var(--red)',
  fontSize: 13,
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

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
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

const footer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  paddingTop: 6,
};

const btnGhost: CSSProperties = {
  padding: '0 18px',
  height: 44,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnPrimary: CSSProperties = {
  padding: '0 22px',
  height: 44,
  borderRadius: 10,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};
