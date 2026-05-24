// Recipe editor card mounted on ProductDetailView. Shows the recipe yield
// (required for PREPARATION), the list of items with inline-editable quantity
// and waste-%, a totals block (cached cost from the parent product/variant),
// and a form to add new items. The displayed totals are authoritative — they
// come from the server-side cached cost; the per-line cost above the table is
// a client estimate that mirrors the backend cost engine.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from '../../../../i18n';
import { ApiError } from '../../../../api/client';
import { Spinner } from '../../../Spinner';
import {
  RECIPE_UNITS,
  type Recipe,
  type RecipeItem,
} from '../../../../api/products';
import type { RecipeOwner } from '../../../../api/recipes';
import {
  useAddRecipeItem,
  useCreateRecipe,
  useDeleteRecipeItem,
  useRecipe,
  useUpdateRecipe,
  useUpdateRecipeItem,
} from '../../../../hooks/useRecipes';
import { formatMoney, formatPct } from '../../../../utils/format';
import { foodCostColor } from '../../../../utils/product-meta';
import {
  estimateItemCost,
  RECIPE_ITEM_COLS,
  RecipeItemRow,
} from './RecipeItemRow';
import { AddRecipeItemForm } from './AddRecipeItemForm';

interface Props {
  owner: RecipeOwner;
  /** PREPARATION recipes require yield_quantity + yield_unit. */
  requiresYield: boolean;
  /** Cached cost from Product/Variant.recipe_cost (centavos). */
  cachedCost?: string;
  /** Sell price (centavos) for an optional food-cost % readout. */
  sellPrice?: string | null;
}

export function RecipeEditor({ owner, requiresYield, cachedCost, sellPrice }: Props) {
  const { t } = useTranslation();
  const recipeQ = useRecipe(owner);
  const createRecipe = useCreateRecipe(owner);

  if (recipeQ.isLoading) {
    return (
      <div style={wrap}>
        <div style={loadingState}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (recipeQ.error) {
    return (
      <div style={wrap}>
        <p style={errorText}>
          {(recipeQ.error as Error).message}
        </p>
      </div>
    );
  }

  const recipe = recipeQ.data ?? null;

  if (!recipe) {
    return (
      <div style={wrap}>
        <div style={emptyState}>
          <p style={emptyTitle}>
            {requiresYield
              ? t('admin.productDetail.recipe.emptyMessagePrep')
              : t('admin.productDetail.recipe.emptyMessage')}
          </p>
          <p style={emptyHint}>
            {t('admin.productDetail.recipe.emptyHint')}
          </p>
          <button
            type="button"
            style={btnPrimary}
            onClick={() =>
              createRecipe.mutate({
                yield_quantity: requiresYield ? 100 : undefined,
                yield_unit: requiresYield ? 'ml' : undefined,
              })
            }
            disabled={createRecipe.isPending}
          >
            {createRecipe.isPending ? (
              <>
                <Spinner size={14} />
                <span>{t('admin.productDetail.recipe.createBtn')}</span>
              </>
            ) : (
              <span>{t('admin.productDetail.recipe.createBtn')}</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <RecipeEditorInner
      owner={owner}
      recipe={recipe}
      requiresYield={requiresYield}
      cachedCost={cachedCost}
      sellPrice={sellPrice}
    />
  );
}

interface InnerProps {
  owner: RecipeOwner;
  recipe: Recipe;
  requiresYield: boolean;
  cachedCost?: string;
  sellPrice?: string | null;
}

function RecipeEditorInner({
  owner,
  recipe,
  requiresYield,
  cachedCost,
  sellPrice,
}: InnerProps) {
  const { t } = useTranslation();
  const addItem = useAddRecipeItem(owner);
  const updateItem = useUpdateRecipeItem(owner);
  const deleteItem = useDeleteRecipeItem(owner);
  const updateRecipe = useUpdateRecipe(owner);

  const [yieldQty, setYieldQty] = useState<string>(recipe.yield_quantity ?? '');
  const [yieldUnit, setYieldUnit] = useState<string>(recipe.yield_unit ?? '');
  const [yieldError, setYieldError] = useState<string | null>(null);

  useEffect(() => {
    setYieldQty(recipe.yield_quantity ?? '');
    setYieldUnit(recipe.yield_unit ?? '');
    setYieldError(null);
  }, [recipe.yield_quantity, recipe.yield_unit, recipe.id]);

  const persistYield = async () => {
    setYieldError(null);
    const trimmed = yieldQty.trim();
    const qty = trimmed ? Number(trimmed) : null;
    if (trimmed && (!Number.isFinite(qty as number) || (qty as number) <= 0)) {
      setYieldError(t('admin.productDetail.recipe.validation.yieldPositive'));
      return;
    }
    if (requiresYield && (!qty || !yieldUnit.trim())) {
      setYieldError(t('admin.productDetail.recipe.validation.prepNeedsYieldAndUnit'));
      return;
    }
    const currentQty =
      recipe.yield_quantity != null ? Number(recipe.yield_quantity) : null;
    const currentUnit = recipe.yield_unit ?? '';
    if (qty === currentQty && yieldUnit.trim() === currentUnit) return;
    try {
      await updateRecipe.mutateAsync({
        recipeId: recipe.id,
        input: {
          yield_quantity: qty,
          yield_unit: yieldUnit.trim() || null,
        },
      });
    } catch (err) {
      setYieldError(
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : t('admin.productDetail.saveError'),
      );
    }
  };

  const items = recipe.items;

  const localCost = useMemo(() => {
    let total = 0;
    let hasUnknown = false;
    for (const it of items) {
      const c = estimateItemCost(it);
      if (c == null) hasUnknown = true;
      else total += c;
    }
    return { total, hasUnknown };
  }, [items]);

  const displayCost = cachedCost != null ? Number(cachedCost) : localCost.total;

  const foodPct = useMemo(() => {
    const sp = sellPrice ? Number(sellPrice) : 0;
    if (!sp) return null;
    return (displayCost / sp) * 100;
  }, [sellPrice, displayCost]);

  const handleDelete = useCallback(
    (itemId: string) =>
      deleteItem.mutate({ recipeId: recipe.id, itemId }),
    [deleteItem, recipe.id],
  );

  const handleUpdate = useCallback(
    (itemId: string, input: { quantity?: number; waste_pct?: number }) =>
      updateItem.mutateAsync({ recipeId: recipe.id, itemId, input }),
    [updateItem, recipe.id],
  );

  const onAddItem: React.ComponentProps<typeof AddRecipeItemForm>['onAdd'] = (input) =>
    addItem.mutateAsync({ recipeId: recipe.id, input });

  const excludePrepId =
    owner.kind === 'product' ? owner.id : undefined;

  return (
    <div style={wrap}>
      {/* Yield card (always shown for PREPARATION; otherwise only if a value is set) */}
      {(requiresYield || recipe.yield_quantity || recipe.yield_unit) && (
        <div style={yieldCard}>
          <div style={yieldHead}>
            <span style={yieldTitle}>
              {t('admin.productDetail.recipe.yield')}
              {requiresYield && (
                <span style={requiredMark}>
                  {' · '}
                  {t('admin.productDetail.recipe.yieldRequired')}
                </span>
              )}
            </span>
          </div>
          <div style={yieldGrid}>
            <label style={fieldShell}>
              <span style={fieldLabel}>
                {t('admin.productDetail.recipe.yieldQuantity')}
              </span>
              <input
                type="number"
                step="any"
                min={0}
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
                onBlur={persistYield}
                disabled={updateRecipe.isPending}
                style={textInput}
              />
            </label>
            <label style={fieldShell}>
              <span style={fieldLabel}>
                {t('admin.productDetail.recipe.yieldUnit')}
              </span>
              <select
                value={yieldUnit}
                onChange={(e) => setYieldUnit(e.target.value)}
                onBlur={persistYield}
                disabled={updateRecipe.isPending}
                style={textInput}
              >
                <option value="">—</option>
                {RECIPE_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </label>
          </div>
          {yieldError && <p style={errorText}>{yieldError}</p>}
        </div>
      )}

      {/* Items table */}
      <div style={tableShell}>
        <div style={{ ...tableHead, gridTemplateColumns: RECIPE_ITEM_COLS }}>
          <span>{t('admin.productDetail.recipe.col.ingredient')}</span>
          <span style={cellNumHead}>{t('admin.productDetail.recipe.col.quantity')}</span>
          <span>{t('admin.productDetail.recipe.col.unit')}</span>
          <span style={cellNumHead}>{t('admin.productDetail.recipe.col.waste')}</span>
          <span style={cellNumHead}>{t('admin.productDetail.recipe.col.lineCost')}</span>
          <span />
        </div>

        {items.length === 0 ? (
          <div style={emptyRow}>
            <p style={emptyRowTitle}>
              {t('admin.productDetail.recipe.emptyIngredients')}
            </p>
            <p style={emptyRowHint}>
              {t('admin.productDetail.recipe.emptyIngredientsHint')}
            </p>
          </div>
        ) : (
          items.map((it: RecipeItem) => (
            <RecipeItemRow
              key={it.id}
              item={it}
              onDelete={handleDelete}
              deleting={deleteItem.isPending}
              onUpdate={handleUpdate}
            />
          ))
        )}
      </div>

      {/* Totals block */}
      <div style={totalsBar}>
        <div>
          <div style={totalsLabel}>
            {t('admin.productDetail.recipe.totalLabel')}
          </div>
          <div style={totalsSub}>
            {cachedCost != null
              ? t('admin.productDetail.recipe.totalHintCached')
              : localCost.hasUnknown
                ? t('admin.productDetail.recipe.totalHintMixed')
                : t('admin.productDetail.recipe.totalHintEstimate')}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={totalsValue}>{formatMoney(displayCost)}</div>
          {foodPct != null && (
            <div style={{ ...totalsSub, color: foodCostColor(foodPct) }}>
              {formatPct(foodPct)} {t('admin.productDetail.recipe.foodCostPctSuffix')}
            </div>
          )}
        </div>
      </div>

      <AddRecipeItemForm onAdd={onAddItem} excludePreparationId={excludePrepId} />
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const wrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const loadingState: CSSProperties = {
  padding: 28,
  display: 'flex',
  justifyContent: 'center',
};

const emptyState: CSSProperties = {
  padding: '32px 24px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  alignItems: 'center',
  background: 'var(--bg2)',
  border: '1px dashed var(--border)',
  borderRadius: 12,
};

const emptyTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  color: 'var(--text1)',
  margin: 0,
};

const emptyHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  margin: 0,
  lineHeight: 1.5,
};

const btnPrimary: CSSProperties = {
  padding: '0 18px',
  height: 40,
  borderRadius: 10,
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

const yieldCard: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const yieldHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const yieldTitle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const requiredMark: CSSProperties = {
  color: 'var(--red)',
  fontWeight: 700,
};

const yieldGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
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

const tableShell: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '10px 16px',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  gap: 12,
  alignItems: 'center',
};

const cellNumHead: CSSProperties = {
  textAlign: 'right',
};

const emptyRow: CSSProperties = {
  padding: '32px 20px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  alignItems: 'center',
};

const emptyRowTitle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  margin: 0,
};

const emptyRowHint: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  margin: 0,
};

const totalsBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  padding: '14px 16px',
  background: 'var(--sidebar)',
  color: '#e8ddd0',
  borderRadius: 10,
};

const totalsLabel: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--gold)',
  fontWeight: 700,
};

const totalsSub: CSSProperties = {
  fontSize: 11,
  color: 'rgba(232,221,208,0.55)',
  marginTop: 4,
};

const totalsValue: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const errorText: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--red)',
  fontWeight: 500,
};
