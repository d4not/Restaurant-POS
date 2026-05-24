// One row in the recipe-items table. Displays the ingredient name + badge
// (Supply / Preparation / Modifier slot), inline-editable quantity and
// waste-%, the line cost estimate, and a delete button. Optimistic-add
// temporary IDs are gated so we don't 404 the backend.

import { memo, useCallback, type CSSProperties } from 'react';
import type { RecipeItem } from '../../../../api/products';
import { formatMoney } from '../../../../utils/format';
import {
  estimatePreparationItemCost,
  estimateSupplyItemCost,
} from '../../../../utils/recipe-cost';
import { useTranslation } from '../../../../i18n';
import { InlineNumberCell } from './InlineNumberCell';

interface Props {
  item: RecipeItem;
  onDelete: (itemId: string) => void;
  deleting: boolean;
  onUpdate: (
    itemId: string,
    input: { quantity?: number; waste_pct?: number },
  ) => Promise<unknown>;
}

export function estimateItemCost(it: RecipeItem): number | null {
  const qty = Number(it.quantity);
  const waste = Number(it.waste_pct);
  if (it.supply_id && it.supply) {
    return estimateSupplyItemCost({
      quantity: qty,
      recipeUnit: it.unit,
      wastePct: waste,
      contentPerUnit:
        it.supply.content_per_unit != null
          ? Number(it.supply.content_per_unit)
          : null,
      contentUnit: it.supply.content_unit,
      averageCost: Number(it.supply.average_cost),
    });
  }
  if (it.modifier_group_id && it.modifier_group) {
    // Slot cost = qty against the default modifier's supply at the modifier
    // group's intrinsic ratio (1.0 by default). Matches the backend engine.
    const def = it.modifier_group.modifiers?.find((m) => m.is_default);
    if (!def?.supply) return null;
    return estimateSupplyItemCost({
      quantity: qty,
      recipeUnit: it.unit,
      wastePct: waste,
      contentPerUnit:
        def.supply.content_per_unit != null
          ? Number(def.supply.content_per_unit)
          : null,
      contentUnit: def.supply.content_unit,
      averageCost: Number(def.supply.average_cost),
    });
  }
  if (it.preparation_id && it.preparation) {
    return estimatePreparationItemCost({
      quantity: qty,
      recipeUnit: it.unit,
      wastePct: waste,
      yieldQuantity: null,
      yieldUnit: null,
      preparationRecipeCost: Number(it.preparation.recipe_cost),
    });
  }
  return null;
}

export const RecipeItemRow = memo(function RecipeItemRow({
  item,
  onDelete,
  deleting,
  onUpdate,
}: Props) {
  const { t } = useTranslation();
  const isTemp = item.id.startsWith('tmp_');

  const handleUpdate = useCallback(
    (input: { quantity?: number; waste_pct?: number }) => {
      if (isTemp) return Promise.resolve();
      return onUpdate(item.id, input);
    },
    [isTemp, onUpdate, item.id],
  );

  const estCost = estimateItemCost(item);
  const kind: 'modifier' | 'preparation' | 'supply' = item.modifier_group_id
    ? 'modifier'
    : item.preparation_id
      ? 'preparation'
      : 'supply';
  const defaultMod = item.modifier_group?.modifiers?.find((m) => m.is_default);
  const label =
    kind === 'modifier'
      ? item.modifier_group?.name ?? '—'
      : item.supply?.name ?? item.preparation?.name ?? '—';

  return (
    <div style={{ ...row, gridTemplateColumns: RECIPE_ITEM_COLS }}>
      <div style={nameCell}>
        <div style={nameMain}>
          {kind === 'modifier' && (
            <span style={slotIcon} title={t('admin.productDetail.recipe.kind.modifier')}>
              🔄
            </span>
          )}
          {label}
        </div>
        <div style={nameMeta}>
          <span style={{ ...kindBadge, ...badgeForKind(kind) }}>
            {kind === 'modifier'
              ? t('admin.productDetail.recipe.kind.modifier')
              : kind === 'preparation'
                ? t('admin.productDetail.recipe.kind.preparation')
                : t('admin.productDetail.recipe.kind.supply')}
          </span>
          {kind === 'modifier' && defaultMod?.supply?.name && (
            <span style={metaText}>
              {' · '}
              {t('admin.productDetail.recipe.modifierSlotNote').replace(
                '{name}',
                defaultMod.supply.name,
              )}
            </span>
          )}
          {kind === 'modifier' && !defaultMod && (
            <span style={metaTextRed}>
              {' · '}
              {t('admin.productDetail.recipe.modifierSlotMissingDefault')}
            </span>
          )}
        </div>
      </div>

      <InlineNumberCell
        value={item.quantity}
        min={0}
        step="any"
        validate={(n) =>
          n > 0
            ? null
            : 'Must be > 0'
        }
        onSave={(n) => handleUpdate({ quantity: n })}
        disabled={isTemp}
      />

      <span style={unitCell}>{item.unit}</span>

      <InlineNumberCell
        value={item.waste_pct}
        min={0}
        max={99}
        step="any"
        emptyAs={0}
        validate={(n) => (n >= 0 && n < 100 ? null : '0–99')}
        onSave={(n) => handleUpdate({ waste_pct: n })}
        disabled={isTemp}
      />

      <span style={costCell}>
        {estCost != null ? formatMoney(estCost) : <span style={muted}>—</span>}
      </span>

      <button
        type="button"
        style={deleteBtn}
        onClick={() => onDelete(item.id)}
        disabled={deleting || isTemp}
        aria-label={t('admin.productDetail.recipe.removeItem')}
      >
        ✕
      </button>
    </div>
  );
});

/* ── Styles + layout constants ─────────────────────────────────────────── */

export const RECIPE_ITEM_COLS =
  'minmax(220px, 2.2fr) 100px 80px 80px 110px 36px';

function badgeForKind(kind: 'modifier' | 'preparation' | 'supply'): CSSProperties {
  if (kind === 'modifier') {
    return {
      background: 'rgba(201,164,92,0.12)',
      color: 'var(--gold)',
      border: '1px solid rgba(201,164,92,0.30)',
    };
  }
  if (kind === 'preparation') {
    return {
      background: 'rgba(74,140,92,0.12)',
      color: 'var(--green)',
      border: '1px solid rgba(74,140,92,0.30)',
    };
  }
  return {
    background: 'rgba(168,152,136,0.16)',
    color: 'var(--text2)',
    border: '1px solid rgba(168,152,136,0.36)',
  };
}

const row: CSSProperties = {
  display: 'grid',
  padding: '10px 16px',
  borderTop: '1px solid var(--border)',
  gap: 12,
  alignItems: 'center',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 56,
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
  fontSize: 13,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const slotIcon: CSSProperties = {
  marginRight: 6,
};

const nameMeta: CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  marginTop: 2,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};

const kindBadge: CSSProperties = {
  display: 'inline-block',
  padding: '2px 7px',
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
};

const metaText: CSSProperties = {
  color: 'var(--text3)',
};

const metaTextRed: CSSProperties = {
  color: 'var(--red)',
  fontWeight: 600,
};

const unitCell: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
};

const costCell: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 14,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};

const muted: CSSProperties = {
  color: 'var(--text3)',
};

const deleteBtn: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
  fontSize: 12,
};
