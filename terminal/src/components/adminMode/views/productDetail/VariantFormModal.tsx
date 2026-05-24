// Small create/edit modal for a single ProductVariant. The terminal has no
// shared Modal primitive — we hand-roll a centred card with a scrim, an Esc
// listener (capture-phase, prevent-default) so we win over the parent
// AdminViewShell's Esc handler, and click-the-scrim-to-close.

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from '../../../../i18n';
import { ApiError } from '../../../../api/client';
import { Spinner } from '../../../Spinner';
import { IconClose } from '../../../Icons';
import {
  useCreateVariant,
  useUpdateVariant,
} from '../../../../hooks/useProducts';
import type { ProductVariant } from '../../../../api/products';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  variant: ProductVariant | null;
  onSaved?: () => void;
  onError?: (msg: string) => void;
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

export function VariantFormModal({
  open,
  onClose,
  productId,
  variant,
  onSaved,
  onError,
}: Props) {
  const { t } = useTranslation();
  const isEdit = !!variant;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const createMut = useCreateVariant(productId);
  const updateMut = useUpdateVariant(productId);
  const pending = createMut.isPending || updateMut.isPending;

  useEffect(() => {
    if (!open) return;
    setForm(variant ? fromVariant(variant) : EMPTY);
    setErrors({});
    setServerError(null);
  }, [open, variant]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !pending) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, onClose, pending]);

  if (!open) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) {
      e.name = t('admin.productDetail.validation.nameRequired');
    }
    const p = Number(form.sell_price);
    if (!form.sell_price.trim() || !Number.isFinite(p) || p < 0) {
      e.sell_price = t('admin.productDetail.validation.sellPriceNonNegative');
    }
    const d = Number(form.display_order);
    if (!Number.isInteger(d) || d < 0) {
      e.display_order = t('admin.productDetail.validation.displayOrderInteger');
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
        await updateMut.mutateAsync({ variantId: variant.id, input: payload });
      } else {
        await createMut.mutateAsync(payload);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : t('admin.productDetail.saveError');
      setServerError(msg);
      onError?.(msg);
    }
  };

  return (
    <div
      style={scrim}
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <h3 style={title}>
            {isEdit
              ? t('admin.productDetail.variantModal.titleEdit')
              : t('admin.productDetail.variantModal.titleNew')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={closeBtn}
            disabled={pending}
            aria-label={t('common.close')}
          >
            <IconClose style={{ fontSize: 14 }} />
          </button>
        </div>

        <form onSubmit={submit} style={body} noValidate>
          {serverError && <div style={errorBanner}>{serverError}</div>}

          <label style={fieldShell}>
            <span style={fieldLabel}>
              {t('admin.productDetail.variantModal.field.name')}
            </span>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              autoFocus
              maxLength={200}
              placeholder={t('admin.productDetail.variantModal.field.namePlaceholder')}
              style={textInput}
            />
            {errors.name && <span style={inlineError}>{errors.name}</span>}
          </label>

          <div style={twoCol}>
            <label style={fieldShell}>
              <span style={fieldLabel}>
                {t('admin.productDetail.variantModal.field.sellPrice')}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={form.sell_price}
                onChange={(e) => set('sell_price', e.target.value)}
                style={textInput}
                placeholder="0.00"
              />
              {errors.sell_price && (
                <span style={inlineError}>{errors.sell_price}</span>
              )}
            </label>

            <label style={fieldShell}>
              <span style={fieldLabel}>
                {t('admin.productDetail.variantModal.field.displayOrder')}
              </span>
              <input
                type="number"
                min={0}
                value={form.display_order}
                onChange={(e) => set('display_order', e.target.value)}
                style={textInput}
              />
              {errors.display_order && (
                <span style={inlineError}>{errors.display_order}</span>
              )}
            </label>
          </div>

          <label style={fieldShell}>
            <span style={fieldLabel}>
              {t('admin.productDetail.variantModal.field.barcode')}
            </span>
            <input
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value)}
              maxLength={64}
              placeholder={t('admin.productDetail.field.barcodePlaceholder')}
              style={{
                ...textInput,
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                letterSpacing: '0.04em',
              }}
            />
          </label>

          <label style={toggleItem}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            <span>{t('admin.productDetail.variantModal.field.active')}</span>
          </label>

          <div style={footer}>
            <button
              type="button"
              style={btnGhost}
              onClick={onClose}
              disabled={pending}
            >
              {t('admin.productDetail.variantModal.cancel')}
            </button>
            <button type="submit" style={btnPrimary} disabled={pending}>
              {pending ? (
                <>
                  <Spinner size={14} />
                  <span>
                    {isEdit
                      ? t('admin.productDetail.variantModal.save')
                      : t('admin.productDetail.variantModal.create')}
                  </span>
                </>
              ) : (
                <span>
                  {isEdit
                    ? t('admin.productDetail.variantModal.save')
                    : t('admin.productDetail.variantModal.create')}
                </span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Styles ────────────────────────────────────────────────── */

const scrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 220,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const panel: CSSProperties = {
  width: 'min(520px, 100%)',
  maxHeight: '88vh',
  background: 'var(--bg2)',
  borderRadius: 14,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const head: CSSProperties = {
  padding: '18px 20px 14px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexShrink: 0,
};

const title: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const closeBtn: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const body: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '18px 20px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
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

const inlineError: CSSProperties = {
  fontSize: 12,
  color: 'var(--red)',
  fontWeight: 500,
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

const twoCol: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
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
  justifyContent: 'flex-end',
  gap: 10,
  paddingTop: 6,
};

const btnGhost: CSSProperties = {
  padding: '0 16px',
  height: 40,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnPrimary: CSSProperties = {
  padding: '0 18px',
  height: 40,
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};
