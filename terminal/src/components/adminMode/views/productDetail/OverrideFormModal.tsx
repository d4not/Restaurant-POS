// Per-product override editor. SWAP groups default to RATIO (scale the recipe
// line), ADD groups default to FIXED_QTY (override the absolute amount). The
// operator can flip between the two with the pill toggle.

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from '../../../../i18n';
import { ApiError } from '../../../../api/client';
import { Spinner } from '../../../Spinner';
import { IconClose } from '../../../Icons';
import {
  useCreateOverride,
  useUpdateOverride,
} from '../../../../hooks/useModifierOverrides';
import type {
  Modifier,
  ModifierGroupType,
  ModifierOverrideType,
  ModifierProductOverride,
} from '../../../../api/products';
import { RECIPE_UNITS } from '../../../../api/products';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  modifier: Modifier | null;
  groupType: ModifierGroupType;
  existingOverride: ModifierProductOverride | null;
  onSaved?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export function OverrideFormModal({
  open,
  onClose,
  productId,
  productName,
  modifier,
  groupType,
  existingOverride,
  onSaved,
  onError,
}: Props) {
  const { t } = useTranslation();
  const defaultType: ModifierOverrideType = groupType === 'SWAP' ? 'RATIO' : 'FIXED_QTY';

  const [type, setType] = useState<ModifierOverrideType>(defaultType);
  const [ratio, setRatio] = useState('1');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useCreateOverride(productId);
  const update = useUpdateOverride(productId);
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    if (existingOverride) {
      setType(existingOverride.override_type);
      setRatio(existingOverride.override_ratio ?? '1');
      setQty(existingOverride.override_quantity ?? '');
      setUnit(existingOverride.override_unit ?? '');
    } else {
      setType(defaultType);
      setRatio('1');
      setQty(modifier?.supply_quantity ?? '');
      setUnit(modifier?.supply_unit ?? '');
    }
    setError(null);
  }, [open, existingOverride, modifier, defaultType]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !saving) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, onClose, saving]);

  if (!open || !modifier) return null;

  const subtitleHtml = t('admin.productDetail.overrideModal.subtitle')
    .replace('{modifier}', modifier.name)
    .replace('{product}', productName);

  const onSubmit = async () => {
    setError(null);
    try {
      if (type === 'RATIO') {
        const r = Number(ratio);
        if (!Number.isFinite(r) || r <= 0) {
          setError(t('admin.productDetail.validation.overrideRatioPositive'));
          return;
        }
        if (existingOverride) {
          await update.mutateAsync({
            modifierId: modifier.id,
            input: {
              override_type: 'RATIO',
              override_ratio: r,
              override_quantity: null,
              override_unit: null,
            },
          });
        } else {
          await create.mutateAsync({
            modifier_id: modifier.id,
            override_type: 'RATIO',
            override_ratio: r,
          });
        }
      } else {
        const q = Number(qty);
        if (!Number.isFinite(q) || q <= 0) {
          setError(t('admin.productDetail.validation.overrideQuantityPositive'));
          return;
        }
        if (!unit) {
          setError(t('admin.productDetail.validation.overrideUnitRequired'));
          return;
        }
        if (existingOverride) {
          await update.mutateAsync({
            modifierId: modifier.id,
            input: {
              override_type: 'FIXED_QTY',
              override_ratio: null,
              override_quantity: q,
              override_unit: unit,
            },
          });
        } else {
          await create.mutateAsync({
            modifier_id: modifier.id,
            override_type: 'FIXED_QTY',
            override_quantity: q,
            override_unit: unit,
          });
        }
      }
      onSaved?.(t('admin.productDetail.overrideModal.saved'));
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : t('admin.productDetail.saveError');
      setError(msg);
      onError?.(msg);
    }
  };

  return (
    <div style={scrim} onClick={() => !saving && onClose()}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <h3 style={title}>
            {existingOverride
              ? t('admin.productDetail.overrideModal.titleEdit')
              : t('admin.productDetail.overrideModal.titleNew')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={closeBtn}
            disabled={saving}
            aria-label={t('common.close')}
          >
            <IconClose style={{ fontSize: 14 }} />
          </button>
        </div>

        <div style={body}>
          {error && <div style={errorBanner}>{error}</div>}

          <p style={subtitle}>{subtitleHtml}</p>

          <div style={fieldShell}>
            <span style={fieldLabel}>
              {t('admin.productDetail.overrideModal.field.type')}
            </span>
            <div style={pillRow}>
              <button
                type="button"
                style={{ ...pillBtn, ...(type === 'RATIO' ? pillActive : {}) }}
                onClick={() => setType('RATIO')}
              >
                {t('admin.productDetail.overrideModal.typeRatio')}
              </button>
              <button
                type="button"
                style={{ ...pillBtn, ...(type === 'FIXED_QTY' ? pillActive : {}) }}
                onClick={() => setType('FIXED_QTY')}
              >
                {t('admin.productDetail.overrideModal.typeFixed')}
              </button>
            </div>
            <span style={fieldHint}>
              {type === 'RATIO'
                ? t('admin.productDetail.overrideModal.ratioHint')
                : t('admin.productDetail.overrideModal.fixedHint')}
            </span>
          </div>

          {type === 'RATIO' ? (
            <label style={fieldShell}>
              <span style={fieldLabel}>
                {t('admin.productDetail.overrideModal.field.ratio')}
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                style={textInput}
              />
              <span style={fieldHint}>× recipe quantity</span>
            </label>
          ) : (
            <div style={twoCol}>
              <label style={fieldShell}>
                <span style={fieldLabel}>
                  {t('admin.productDetail.overrideModal.field.quantity')}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  style={textInput}
                />
              </label>
              <label style={fieldShell}>
                <span style={fieldLabel}>
                  {t('admin.productDetail.overrideModal.field.unit')}
                </span>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  style={textInput}
                >
                  <option value="">—</option>
                  {RECIPE_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div style={footer}>
            <button
              type="button"
              style={btnGhost}
              onClick={onClose}
              disabled={saving}
            >
              {t('admin.productDetail.overrideModal.cancel')}
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={btnPrimary}
              onClick={onSubmit}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Spinner size={14} />
                  <span>
                    {existingOverride
                      ? t('admin.productDetail.overrideModal.save')
                      : t('admin.productDetail.overrideModal.create')}
                  </span>
                </>
              ) : (
                <span>
                  {existingOverride
                    ? t('admin.productDetail.overrideModal.save')
                    : t('admin.productDetail.overrideModal.create')}
                </span>
              )}
            </button>
          </div>
        </div>
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
  width: 'min(480px, 100%)',
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

const subtitle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  margin: 0,
  lineHeight: 1.5,
};

const fieldShell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
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

const pillRow: CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  flexWrap: 'wrap',
};

const pillBtn: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.04em',
};

const pillActive: CSSProperties = {
  background: 'var(--text1)',
  color: '#fff',
  borderColor: 'var(--text1)',
};

const twoCol: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const footer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
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
