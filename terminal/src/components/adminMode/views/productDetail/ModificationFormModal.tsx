// Create/edit a ProductModification. Same modal shape as VariantFormModal
// but with a "Linked supply" selector since modifications drive their own
// inventory deduction.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../../../i18n';
import { ApiError, api } from '../../../../api/client';
import type { PageResult } from '../../../../api/pagination';
import { Spinner } from '../../../Spinner';
import { IconClose } from '../../../Icons';
import {
  useCreateModification,
  useUpdateModification,
} from '../../../../hooks/useProductModifications';
import type { ProductModification } from '../../../../api/products';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  modification: ProductModification | null;
  onSaved?: (msg: string) => void;
  onError?: (msg: string) => void;
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

function fromMod(m: ProductModification): FormState {
  return {
    name: m.name,
    sell_price: String(Number(m.sell_price) / 100),
    barcode: m.barcode ?? '',
    supply_id: m.supply_id ?? '',
    display_order: String(m.display_order),
    active: m.active,
  };
}

interface SupplyLite {
  id: string;
  name: string;
}

async function fetchAllSupplies(): Promise<SupplyLite[]> {
  const out: SupplyLite[] = [];
  let cursor: string | null = null;
  do {
    const qs: string[] = ['limit=100', 'active=true'];
    if (cursor) qs.push(`cursor=${cursor}`);
    const page = await api.get<PageResult<SupplyLite>>(`/supplies?${qs.join('&')}`);
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 1000) break;
  } while (cursor);
  return out;
}

export function ModificationFormModal({
  open,
  onClose,
  productId,
  modification,
  onSaved,
  onError,
}: Props) {
  const { t } = useTranslation();
  const isEdit = !!modification;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const suppliesQ = useQuery({
    queryKey: ['admin', 'suppliesForModifications'],
    queryFn: fetchAllSupplies,
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const createMut = useCreateModification(productId);
  const updateMut = useUpdateModification(productId);
  const pending = createMut.isPending || updateMut.isPending;

  useEffect(() => {
    if (!open) return;
    setForm(modification ? fromMod(modification) : EMPTY);
    setErrors({});
    setServerError(null);
  }, [open, modification]);

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

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const supplyOptions = useMemo(() => suppliesQ.data ?? [], [suppliesQ.data]);

  if (!open) return null;

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
      supply_id: form.supply_id || null,
      display_order: Number(form.display_order),
      active: form.active,
    };
    try {
      if (isEdit && modification) {
        await updateMut.mutateAsync({
          modificationId: modification.id,
          input: payload,
        });
      } else {
        await createMut.mutateAsync(payload);
      }
      onSaved?.(t('admin.productDetail.modifications.saveSuccess'));
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
    <div style={scrim} onClick={() => !pending && onClose()}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <h3 style={title}>
            {isEdit
              ? t('admin.productDetail.modificationModal.titleEdit')
              : t('admin.productDetail.modificationModal.titleNew')}
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
              {t('admin.productDetail.modificationModal.field.name')}
            </span>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              autoFocus
              maxLength={200}
              placeholder={t('admin.productDetail.modificationModal.field.namePlaceholder')}
              style={textInput}
            />
            {errors.name && <span style={inlineError}>{errors.name}</span>}
          </label>

          <div style={twoCol}>
            <label style={fieldShell}>
              <span style={fieldLabel}>
                {t('admin.productDetail.modificationModal.field.sellPrice')}
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={form.sell_price}
                onChange={(e) => set('sell_price', e.target.value)}
                style={textInput}
              />
              {errors.sell_price && <span style={inlineError}>{errors.sell_price}</span>}
            </label>
            <label style={fieldShell}>
              <span style={fieldLabel}>
                {t('admin.productDetail.modificationModal.field.displayOrder')}
              </span>
              <input
                type="number"
                min={0}
                value={form.display_order}
                onChange={(e) => set('display_order', e.target.value)}
                style={textInput}
              />
              {errors.display_order && <span style={inlineError}>{errors.display_order}</span>}
            </label>
          </div>

          <label style={fieldShell}>
            <span style={fieldLabel}>
              {t('admin.productDetail.modificationModal.field.barcode')}
            </span>
            <input
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value)}
              maxLength={64}
              style={{
                ...textInput,
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
              }}
            />
          </label>

          <label style={fieldShell}>
            <span style={fieldLabel}>
              {t('admin.productDetail.modificationModal.field.supply')}
            </span>
            <select
              value={form.supply_id}
              onChange={(e) => set('supply_id', e.target.value)}
              disabled={suppliesQ.isLoading}
              style={textInput}
            >
              <option value="">
                {t('admin.productDetail.modificationModal.field.supplyNone')}
              </option>
              {supplyOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label style={toggleItem}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            <span>{t('admin.productDetail.modificationModal.field.active')}</span>
          </label>

          <div style={footer}>
            <button type="button" style={btnGhost} onClick={onClose} disabled={pending}>
              {t('admin.productDetail.modificationModal.cancel')}
            </button>
            <span style={{ flex: 1 }} />
            <button type="submit" style={btnPrimary} disabled={pending}>
              {pending ? (
                <>
                  <Spinner size={14} />
                  <span>
                    {isEdit
                      ? t('admin.productDetail.modificationModal.save')
                      : t('admin.productDetail.modificationModal.create')}
                  </span>
                </>
              ) : (
                <span>
                  {isEdit
                    ? t('admin.productDetail.modificationModal.save')
                    : t('admin.productDetail.modificationModal.create')}
                </span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Styles (shared with the rest of the productDetail modals) ─ */

const scrim: CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 220,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};
const panel: CSSProperties = {
  width: 'min(520px, 100%)', maxHeight: '88vh',
  background: 'var(--bg2)', borderRadius: 14,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const head: CSSProperties = {
  padding: '18px 20px 14px',
  borderBottom: '1px solid var(--border)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
const title: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20, fontWeight: 600, color: 'var(--text1)', margin: 0,
};
const closeBtn: CSSProperties = {
  width: 34, height: 34, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text2)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const body: CSSProperties = {
  flex: 1, minHeight: 0, overflowY: 'auto',
  padding: '18px 20px 20px',
  display: 'flex', flexDirection: 'column', gap: 14,
};
const errorBanner: CSSProperties = {
  padding: '10px 12px', borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'rgba(196,80,64,0.08)',
  color: 'var(--red)', fontSize: 13,
};
const fieldShell: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5 };
const fieldLabel: CSSProperties = {
  fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'var(--text3)', fontWeight: 700,
};
const inlineError: CSSProperties = { fontSize: 12, color: 'var(--red)', fontWeight: 500 };
const textInput: CSSProperties = {
  width: '100%', height: 38,
  border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--bg2)', padding: '0 12px',
  fontSize: 14, color: 'var(--text1)', fontFamily: 'inherit', outline: 'none',
};
const twoCol: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const toggleItem: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  fontSize: 13, color: 'var(--text1)', cursor: 'pointer',
};
const footer: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6,
};
const btnGhost: CSSProperties = {
  padding: '0 16px', height: 40, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg2)',
  color: 'var(--text1)', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
};
const btnPrimary: CSSProperties = {
  padding: '0 18px', height: 40, borderRadius: 8,
  border: '1px solid var(--text1)', background: 'var(--text1)',
  color: '#fff', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
};
