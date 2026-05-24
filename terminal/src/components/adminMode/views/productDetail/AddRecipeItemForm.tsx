// Bottom-of-recipe form for adding a new ingredient. The "kind" pill row
// switches between Supply, Preparation, and Modifier (SWAP-only) sources;
// the entity dropdown re-populates against the chosen list. The form keeps
// quantity / unit / waste local until the "+ Add" button POSTs.

import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../../../i18n';
import { Spinner } from '../../../Spinner';
import { fetchAllSupplies } from '../../../../api/supplies';
import { listProductsAdmin } from '../../../../api/products';
import { useAllModifierGroups } from '../../../../hooks/useModifierGroups';
import { RECIPE_UNITS, type RecipeUnit } from '../../../../api/products';

interface Props {
  /** Resolves with the new RecipeItem; the editor invalidates queries on success. */
  onAdd: (input: {
    supply_id?: string | null;
    preparation_id?: string | null;
    modifier_group_id?: string | null;
    quantity: number;
    unit: string;
    waste_pct?: number;
  }) => Promise<unknown>;
  /** Forbid a preparation from referencing itself. */
  excludePreparationId?: string;
}

type AddKind = 'supply' | 'preparation' | 'modifier';

export function AddRecipeItemForm({ onAdd, excludePreparationId }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AddKind>('supply');
  const [entityId, setEntityId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<RecipeUnit | ''>('');
  const [wastePct, setWastePct] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const suppliesQ = useQuery({
    queryKey: ['admin', 'supplies', 'forRecipe'],
    queryFn: fetchAllSupplies,
    staleTime: 5 * 60_000,
  });

  const prepsQ = useQuery({
    queryKey: ['admin', 'products', 'preparations'],
    queryFn: () => listProductsAdmin({ includeInactive: false }),
    staleTime: 30_000,
    select: (data) =>
      data.filter(
        (p) => p.type === 'PREPARATION' && p.id !== excludePreparationId,
      ),
  });

  const groupsQ = useAllModifierGroups();
  const swapGroups = useMemo(
    () => (groupsQ.data ?? []).filter((g) => g.type === 'SWAP'),
    [groupsQ.data],
  );

  const switchKind = (next: AddKind) => {
    setKind(next);
    setEntityId('');
    setErrors({});
    setServerError(null);
  };

  const selectedGroup = useMemo(
    () => swapGroups.find((g) => g.id === entityId) ?? null,
    [swapGroups, entityId],
  );
  const selectedGroupDefault = useMemo(
    () => selectedGroup?.modifiers?.find((m) => m.is_default) ?? null,
    [selectedGroup],
  );

  const entityOptions = useMemo(() => {
    if (kind === 'supply') {
      return (suppliesQ.data ?? []).map((s) => ({ value: s.id, label: s.name }));
    }
    if (kind === 'preparation') {
      return (prepsQ.data ?? []).map((p) => ({ value: p.id, label: p.name }));
    }
    return swapGroups.map((g) => {
      const def = g.modifiers?.find((m) => m.is_default);
      return def
        ? { value: g.id, label: `${g.name} — ${t('admin.productDetail.recipe.defaultPrefix')} ${def.name}` }
        : { value: g.id, label: `${g.name} — ${t('admin.productDetail.modifierGroups.noDefault')}` };
    });
  }, [kind, suppliesQ.data, prepsQ.data, swapGroups, t]);

  const loadingEntities =
    kind === 'supply'
      ? suppliesQ.isLoading
      : kind === 'preparation'
        ? prepsQ.isLoading
        : groupsQ.isLoading;

  const reset = () => {
    setEntityId('');
    setQuantity('');
    setUnit('');
    setWastePct('0');
    setErrors({});
    setServerError(null);
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!entityId) {
      e.entityId = t('admin.productDetail.recipe.validation.entityRequired');
    }
    const q = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(q) || q <= 0) {
      e.quantity = t('admin.productDetail.recipe.validation.quantityPositive');
    }
    if (!unit) e.unit = t('admin.productDetail.recipe.validation.unitRequired');
    const w = Number(wastePct);
    if (!Number.isFinite(w) || w < 0 || w >= 100) {
      e.wastePct = t('admin.productDetail.recipe.validation.wasteRange');
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setAdding(true);
    setServerError(null);
    try {
      if (kind === 'modifier') {
        if (!selectedGroup) {
          throw new Error(t('admin.productDetail.recipe.validation.entityRequired'));
        }
        if (!selectedGroupDefault) {
          throw new Error(t('admin.productDetail.recipe.validation.swapNeedsDefault'));
        }
        await onAdd({
          modifier_group_id: selectedGroup.id,
          quantity: q,
          unit: unit as string,
          waste_pct: w,
        });
      } else {
        await onAdd({
          supply_id: kind === 'supply' ? entityId : null,
          preparation_id: kind === 'preparation' ? entityId : null,
          quantity: q,
          unit: unit as string,
          waste_pct: w,
        });
      }
      reset();
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : t('admin.productDetail.saveError'),
      );
    } finally {
      setAdding(false);
    }
  };

  const entityLabel =
    kind === 'supply'
      ? t('admin.productDetail.recipe.kind.supply')
      : kind === 'preparation'
        ? t('admin.productDetail.recipe.kind.preparation')
        : t('admin.productDetail.recipe.kind.modifier');

  return (
    <div style={card}>
      <h4 style={cardTitle}>{t('admin.productDetail.recipe.addTitle')}</h4>

      {serverError && <div style={errorBanner}>{serverError}</div>}

      <div style={pillRow}>
        <button
          type="button"
          style={{ ...pillBtn, ...(kind === 'supply' ? pillActive : {}) }}
          onClick={() => switchKind('supply')}
        >
          {t('admin.productDetail.recipe.kind.supply')}
        </button>
        <button
          type="button"
          style={{ ...pillBtn, ...(kind === 'preparation' ? pillActive : {}) }}
          onClick={() => switchKind('preparation')}
        >
          {t('admin.productDetail.recipe.kind.preparation')}
        </button>
        <button
          type="button"
          style={{ ...pillBtn, ...(kind === 'modifier' ? pillActive : {}) }}
          onClick={() => switchKind('modifier')}
        >
          {t('admin.productDetail.recipe.kind.modifier')}
        </button>
      </div>

      {kind === 'modifier' && selectedGroup && (
        <div style={infoBanner}>
          {selectedGroupDefault ? (
            <span>
              🔄 {t('admin.productDetail.recipe.modifierSlotIntro')
                .replace('{group}', selectedGroup.name)
                .replace(
                  '{default}',
                  selectedGroupDefault.supply?.name ?? selectedGroupDefault.name,
                )}
            </span>
          ) : (
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>
              ⚠{' '}
              {t('admin.productDetail.recipe.modifierSlotMissingDefaultFull').replace(
                '{group}',
                selectedGroup.name,
              )}
            </span>
          )}
        </div>
      )}

      <div style={grid}>
        <label style={fieldShell}>
          <span style={fieldLabel}>{entityLabel}</span>
          <select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            disabled={loadingEntities || entityOptions.length === 0}
            style={textInput}
          >
            <option value="">
              {loadingEntities
                ? t('common.loading')
                : entityOptions.length === 0
                  ? `— ${t('common.noResults')} —`
                  : t('admin.productDetail.recipe.selectPlaceholder')}
            </option>
            {entityOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {errors.entityId && <span style={inlineError}>{errors.entityId}</span>}
        </label>

        <label style={fieldShell}>
          <span style={fieldLabel}>
            {t('admin.productDetail.recipe.col.quantity')}
          </span>
          <input
            type="number"
            step="any"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={textInput}
          />
          {errors.quantity && <span style={inlineError}>{errors.quantity}</span>}
        </label>

        <label style={fieldShell}>
          <span style={fieldLabel}>{t('admin.productDetail.recipe.col.unit')}</span>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as RecipeUnit | '')}
            style={textInput}
          >
            <option value="">—</option>
            {RECIPE_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          {errors.unit && <span style={inlineError}>{errors.unit}</span>}
        </label>

        <label style={fieldShell}>
          <span style={fieldLabel}>
            {t('admin.productDetail.recipe.col.waste')}
          </span>
          <input
            type="number"
            step="any"
            min={0}
            max={99}
            value={wastePct}
            onChange={(e) => setWastePct(e.target.value)}
            style={textInput}
          />
          {errors.wastePct && <span style={inlineError}>{errors.wastePct}</span>}
        </label>

        <div style={addBtnSlot}>
          <button
            type="button"
            style={addBtn}
            onClick={submit}
            disabled={adding}
          >
            {adding ? (
              <>
                <Spinner size={14} />
                <span>{t('admin.productDetail.recipe.addBtn')}</span>
              </>
            ) : (
              <span>{t('admin.productDetail.recipe.addBtn')}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const card: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const cardTitle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  margin: 0,
};

const errorBanner: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'rgba(196,80,64,0.08)',
  color: 'var(--red)',
  fontSize: 13,
};

const pillRow: CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: 6,
};

const pillBtn: CSSProperties = {
  padding: '6px 13px',
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

const infoBanner: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--bg)',
  fontSize: 12,
  color: 'var(--text2)',
  lineHeight: 1.45,
};

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 2fr) 110px 110px 110px auto',
  gap: 10,
  alignItems: 'end',
};

const fieldShell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const fieldLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const inlineError: CSSProperties = {
  fontSize: 11,
  color: 'var(--red)',
  fontWeight: 500,
};

const textInput: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const addBtnSlot: CSSProperties = {
  display: 'flex',
  alignItems: 'end',
};

const addBtn: CSSProperties = {
  padding: '0 16px',
  height: 38,
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
  whiteSpace: 'nowrap',
};
