import { useEffect, useMemo, useState } from 'react';
import { Button, Badge, EmptyState } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useAddRecipeItem,
  useCreateRecipe,
  useDeleteRecipeItem,
  useRecipe,
  useUpdateRecipe,
} from '../../hooks/useRecipes';
import { useSupplies } from '../../hooks/useSupplies';
import { useProducts } from '../../hooks/useProducts';
import { formatMoney, formatNumber, formatPct } from '../../utils/format';
import {
  estimatePreparationItemCost,
  estimateSupplyItemCost,
} from './recipe-cost';
import {
  RECIPE_UNITS,
  type Recipe,
  type RecipeItem,
  type RecipeUnit,
} from '../../types/menu';

interface Props {
  owner: { kind: 'product'; id: string } | { kind: 'variant'; id: string };
  /** PREPARATION recipes must have yield_quantity / yield_unit. */
  requiresYield: boolean;
  /** Authoritative cached cost from Product/Variant.recipe_cost (centavos). */
  cachedCost?: string;
  /** If supplied, shows a food-cost % next to total. */
  sellPrice?: string | null;
}

/**
 * Full recipe editor: lists items, lets the user add/remove them, and shows
 * live line costs computed against the backend's formulas. The "total" number
 * comes from the backend-cached cost — we never pretend to be authoritative.
 */
export function RecipeEditor({ owner, requiresYield, cachedCost, sellPrice }: Props) {
  const recipeQ = useRecipe(owner);
  const createRecipe = useCreateRecipe(owner);
  const updateRecipe = useUpdateRecipe(owner);

  if (recipeQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading recipe…
      </div>
    );
  }

  if (recipeQ.error) {
    return (
      <EmptyState
        icon="⚠"
        message="Couldn't load recipe"
        sub={(recipeQ.error as Error).message}
      />
    );
  }

  const recipe = recipeQ.data ?? null;

  if (!recipe) {
    return (
      <EmptyState
        message="No recipe yet"
        sub={
          requiresYield
            ? 'Create the recipe to start adding ingredients and define the yield (needed for preparations).'
            : 'Create the recipe to start adding ingredients.'
        }
        action={
          <Button
            variant="primary"
            loading={createRecipe.isPending}
            onClick={() => {
              createRecipe.mutate({
                yield_quantity: requiresYield ? 100 : undefined,
                yield_unit: requiresYield ? 'ml' : undefined,
              });
            }}
          >
            + Create recipe
          </Button>
        }
      />
    );
  }

  return (
    <RecipeEditorInner
      owner={owner}
      recipe={recipe}
      requiresYield={requiresYield}
      cachedCost={cachedCost}
      sellPrice={sellPrice}
      onUpdateYield={(input) =>
        updateRecipe.mutateAsync({ recipeId: recipe.id, input })
      }
      updatingYield={updateRecipe.isPending}
    />
  );
}

/* ───────────────────────────────────────────────────────── */

interface InnerProps {
  owner: Props['owner'];
  recipe: Recipe;
  requiresYield: boolean;
  cachedCost?: string;
  sellPrice?: string | null;
  onUpdateYield: (input: {
    yield_quantity?: number | null;
    yield_unit?: string | null;
  }) => Promise<Recipe>;
  updatingYield: boolean;
}

function RecipeEditorInner({
  owner,
  recipe,
  requiresYield,
  cachedCost,
  sellPrice,
  onUpdateYield,
  updatingYield,
}: InnerProps) {
  const addItem = useAddRecipeItem(owner);
  const deleteItem = useDeleteRecipeItem(owner);

  // Yield editing mirrors the stored value; we only persist on blur so we
  // don't POST per keystroke.
  const [yieldQty, setYieldQty] = useState<string>(
    recipe.yield_quantity ?? '',
  );
  const [yieldUnit, setYieldUnit] = useState<string>(recipe.yield_unit ?? '');
  const [yieldError, setYieldError] = useState<string | null>(null);

  useEffect(() => {
    setYieldQty(recipe.yield_quantity ?? '');
    setYieldUnit(recipe.yield_unit ?? '');
    setYieldError(null);
  }, [recipe.yield_quantity, recipe.yield_unit, recipe.id]);

  const persistYield = async () => {
    setYieldError(null);
    const qty = yieldQty.trim() ? Number(yieldQty) : null;
    if (yieldQty.trim() && (!Number.isFinite(qty) || (qty as number) <= 0)) {
      setYieldError('Yield must be a positive number');
      return;
    }
    if (requiresYield && (!qty || !yieldUnit.trim())) {
      setYieldError('Preparations require both a yield quantity and unit');
      return;
    }
    // Only submit when something actually changed.
    const currentQty =
      recipe.yield_quantity != null ? Number(recipe.yield_quantity) : null;
    const currentUnit = recipe.yield_unit ?? '';
    if (qty === currentQty && yieldUnit.trim() === currentUnit) return;
    try {
      await onUpdateYield({
        yield_quantity: qty,
        yield_unit: yieldUnit.trim() || null,
      });
    } catch (err) {
      setYieldError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const items = recipe.items;

  const totalLocalCost = useMemo(() => {
    let total = 0;
    let hasUnknown = false;
    for (const it of items) {
      const c = estimateItemCost(it);
      if (c == null) hasUnknown = true;
      else total += c;
    }
    return { total, hasUnknown };
  }, [items]);

  const displayCost =
    cachedCost != null ? Number(cachedCost) : totalLocalCost.total;

  const foodCostPct =
    sellPrice && Number(sellPrice) > 0
      ? (displayCost / Number(sellPrice)) * 100
      : null;

  const onAddItem = (input: {
    supply_id?: string | null;
    preparation_id?: string | null;
    quantity: number;
    unit: string;
    waste_pct?: number;
  }) => addItem.mutateAsync({ recipeId: recipe.id, input });

  return (
    <div>
      {/* Yield (required for preparations, optional otherwise) */}
      {(requiresYield || recipe.yield_quantity || recipe.yield_unit) && (
        <div
          className="card mb-12"
          style={{ padding: 14, background: 'var(--bg)' }}
        >
          <div className="fs-11 text-muted fw-600 mb-8" style={{ letterSpacing: 0.8, textTransform: 'uppercase' }}>
            Recipe yield
            {requiresYield && <span className="text-red"> · required</span>}
          </div>
          <div className="section-grid-2">
            <Input
              label="Yield quantity"
              name="yield_quantity"
              type="number"
              step="any"
              min="0"
              value={yieldQty}
              onChange={(e) => setYieldQty(e.target.value)}
              onBlur={persistYield}
              disabled={updatingYield}
            />
            <div className="field">
              <label htmlFor="yield_unit">Yield unit</label>
              <select
                id="yield_unit"
                value={yieldUnit}
                onChange={(e) => setYieldUnit(e.target.value)}
                onBlur={persistYield}
                disabled={updatingYield}
              >
                <option value="">— select —</option>
                {RECIPE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {yieldError && <div className="field-error">{yieldError}</div>}
        </div>
      )}

      {/* Recipe items table */}
      <div className="table-wrap mb-12">
        <div
          className="table-head"
          style={{
            gridTemplateColumns: '2fr 110px 100px 90px 130px 40px',
          }}
        >
          <div>Ingredient</div>
          <div>Quantity</div>
          <div>Unit</div>
          <div>Waste %</div>
          <div>Line cost</div>
          <div />
        </div>

        {items.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 16px' }}>
            <div className="msg">No ingredients yet</div>
            <div className="sub">Add supplies and preparations below.</div>
          </div>
        ) : (
          items.map((it, idx) => (
            <RecipeItemRow
              key={it.id}
              item={it}
              even={idx % 2 === 0}
              onDelete={() =>
                deleteItem.mutate({ recipeId: recipe.id, itemId: it.id })
              }
              deleting={deleteItem.isPending}
            />
          ))
        )}
      </div>

      {/* Totals block */}
      <div
        className="flex-between mb-16"
        style={{
          padding: '10px 14px',
          background: 'var(--sidebar2)',
          color: '#f0e0c0',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <div>
          <div
            className="fs-11"
            style={{
              color: 'var(--gold)',
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            Total recipe cost
          </div>
          <div className="fs-11" style={{ color: '#7a5840', marginTop: 2 }}>
            {totalLocalCost.hasUnknown
              ? 'Backend-calculated · some lines can’t be previewed locally'
              : 'Cached on the product — updated on every change'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="fw-700" style={{ fontSize: 18 }}>
            {formatMoney(displayCost)}
          </div>
          {foodCostPct != null && (
            <div className="fs-11" style={{ color: '#b8a888', marginTop: 2 }}>
              {formatPct(foodCostPct)} food cost
            </div>
          )}
        </div>
      </div>

      {/* Add item inline form */}
      <AddRecipeItemForm
        onAdd={onAddItem}
        excludePreparationId={
          owner.kind === 'product' ? owner.id : undefined
        }
      />
    </div>
  );
}

/* ───────────────────────────────────────────────────────── */

function estimateItemCost(it: RecipeItem): number | null {
  const qty = Number(it.quantity);
  const waste = Number(it.waste_pct);
  if (it.supply_id && it.supply) {
    return estimateSupplyItemCost({
      quantity: qty,
      recipeUnit: it.unit,
      wastePct: waste,
      contentPerUnit:
        it.supply.content_per_unit != null ? Number(it.supply.content_per_unit) : null,
      contentUnit: it.supply.content_unit,
      averageCost: Number(it.supply.average_cost),
    });
  }
  if (it.preparation_id && it.preparation) {
    // The recipe endpoint doesn't embed the preparation's yield, so local
    // preview is only accurate when quantity × recipe_cost happens to align.
    // Fall back to backend-authoritative total.
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

interface RecipeItemRowProps {
  item: RecipeItem;
  even: boolean;
  onDelete: () => void;
  deleting: boolean;
}

function RecipeItemRow({ item, even, onDelete, deleting }: RecipeItemRowProps) {
  const estCost = estimateItemCost(item);
  const label = item.supply?.name ?? item.preparation?.name ?? 'Unknown';
  const kind = item.supply_id ? 'supply' : 'preparation';
  return (
    <div
      className={`table-row ${even ? 'even' : 'odd'}`}
      style={{
        gridTemplateColumns: '2fr 110px 100px 90px 130px 40px',
        cursor: 'default',
      }}
    >
      <div>
        <div className="fw-600 fs-13">{label}</div>
        <div className="fs-11 text-muted mt-4">
          <Badge tone={kind === 'preparation' ? 'gold' : 'gray'}>
            {kind === 'preparation' ? 'Preparation' : 'Supply'}
          </Badge>
        </div>
      </div>
      <div className="fs-13">{formatNumber(item.quantity, 4)}</div>
      <div className="fs-13 text-muted">{item.unit}</div>
      <div className="fs-13">
        {Number(item.waste_pct) > 0 ? formatPct(item.waste_pct) : '—'}
      </div>
      <div className="fs-13 fw-600">
        {estCost != null ? formatMoney(estCost) : <span className="text-muted">—</span>}
      </div>
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onDelete}
          disabled={deleting}
          title="Remove"
          aria-label="Remove item"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────── */

interface AddFormProps {
  onAdd: (input: {
    supply_id?: string | null;
    preparation_id?: string | null;
    quantity: number;
    unit: string;
    waste_pct?: number;
  }) => Promise<unknown>;
  /** Forbid a preparation from referencing itself as an ingredient. */
  excludePreparationId?: string;
}

function AddRecipeItemForm({ onAdd, excludePreparationId }: AddFormProps) {
  const [kind, setKind] = useState<'supply' | 'preparation'>('supply');
  const [entityId, setEntityId] = useState<string>('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<RecipeUnit | ''>('');
  const [wastePct, setWastePct] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Clear the currently-selected entity when switching kind so stale IDs
  // from the other list don't submit.
  const switchKind = (next: 'supply' | 'preparation') => {
    setKind(next);
    setEntityId('');
  };

  const suppliesQ = useSupplies({ active: true });
  const prepsQ = useProducts({ type: 'PREPARATION', active: true });

  const entityOptions = useMemo(() => {
    if (kind === 'supply') {
      const items = suppliesQ.data?.pages.flatMap((p) => p.items) ?? [];
      return items.map((s) => ({ value: s.id, label: s.name }));
    }
    const items = prepsQ.data?.pages.flatMap((p) => p.items) ?? [];
    return items
      .filter((p) => p.id !== excludePreparationId)
      .map((p) => ({ value: p.id, label: p.name }));
  }, [kind, suppliesQ.data, prepsQ.data, excludePreparationId]);

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
    if (!entityId) e.entityId = `Select a ${kind}`;
    const q = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(q) || q <= 0) {
      e.quantity = 'Must be positive';
    }
    if (!unit) e.unit = 'Required';
    const w = Number(wastePct);
    if (!Number.isFinite(w) || w < 0 || w >= 100) {
      e.wastePct = '0–99';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setAdding(true);
    setServerError(null);
    try {
      await onAdd({
        supply_id: kind === 'supply' ? entityId : null,
        preparation_id: kind === 'preparation' ? entityId : null,
        quantity: q,
        unit: unit as string,
        waste_pct: w,
      });
      reset();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <div
        className="fs-11 text-muted fw-600 mb-8"
        style={{ letterSpacing: 0.8, textTransform: 'uppercase' }}
      >
        Add ingredient
      </div>

      {serverError && (
        <div className="auth-alert" style={{ marginBottom: 12 }}>
          {serverError}
        </div>
      )}

      <div className="flex gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`filter-pill ${kind === 'supply' ? 'active' : ''}`}
          onClick={() => switchKind('supply')}
        >
          Supply
        </button>
        <button
          type="button"
          className={`filter-pill ${kind === 'preparation' ? 'active' : ''}`}
          onClick={() => switchKind('preparation')}
        >
          Preparation
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
          gap: 10,
          alignItems: 'start',
        }}
      >
        <Select
          label={kind === 'supply' ? 'Supply' : 'Preparation'}
          name="entityId"
          value={entityId}
          onValueChange={setEntityId}
          placeholder={
            (kind === 'supply' ? suppliesQ.isLoading : prepsQ.isLoading)
              ? 'Loading…'
              : entityOptions.length === 0
                ? `No ${kind}s available`
                : 'Select…'
          }
          options={entityOptions}
          error={errors.entityId}
          disabled={
            (kind === 'supply' ? suppliesQ.isLoading : prepsQ.isLoading) ||
            entityOptions.length === 0
          }
        />
        <Input
          label="Quantity"
          name="quantity"
          type="number"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          error={errors.quantity}
        />
        <div className="field">
          <label htmlFor="new-item-unit">Unit</label>
          <select
            id="new-item-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as RecipeUnit | '')}
          >
            <option value="">—</option>
            {RECIPE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          {errors.unit && <div className="field-error">{errors.unit}</div>}
        </div>
        <Input
          label="Waste %"
          name="waste"
          type="number"
          step="any"
          min="0"
          max="99"
          value={wastePct}
          onChange={(e) => setWastePct(e.target.value)}
          error={errors.wastePct}
        />
        <div style={{ paddingTop: 22 }}>
          <Button variant="primary" onClick={submit} loading={adding}>
            + Add
          </Button>
        </div>
      </div>
    </div>
  );
}
