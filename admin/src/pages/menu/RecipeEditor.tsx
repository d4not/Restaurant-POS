import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Badge, EmptyState } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useAddRecipeItem,
  useCreateRecipe,
  useDeleteRecipeItem,
  useRecipe,
  useUpdateRecipe,
  useUpdateRecipeItem,
} from '../../hooks/useRecipes';
import { useSupplies } from '../../hooks/useSupplies';
import { useProducts } from '../../hooks/useProducts';
import { useModifierGroups } from '../../hooks/useModifierGroups';
import { formatMoney, formatPct } from '../../utils/format';
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
  const updateItem = useUpdateRecipeItem(owner);

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

  const displayCost = useMemo(
    () => (cachedCost != null ? Number(cachedCost) : totalLocalCost.total),
    [cachedCost, totalLocalCost.total],
  );

  const foodCostPct = useMemo(
    () =>
      sellPrice && Number(sellPrice) > 0
        ? (displayCost / Number(sellPrice)) * 100
        : null,
    [sellPrice, displayCost],
  );

  const onAddItem = (input: {
    supply_id?: string | null;
    preparation_id?: string | null;
    modifier_group_id?: string | null;
    quantity: number;
    unit: string;
    waste_pct?: number;
  }) => addItem.mutateAsync({ recipeId: recipe.id, input });

  // Stable handlers so memoized RecipeItemRow doesn't re-render on
  // every keystroke. Identity only changes when the recipe id or the
  // mutation hook objects swap.
  const handleDelete = useCallback(
    (id: string) => deleteItem.mutate({ recipeId: recipe.id, itemId: id }),
    [deleteItem, recipe.id],
  );
  const handleUpdate = useCallback(
    (
      id: string,
      input: { quantity?: number; waste_pct?: number },
    ) =>
      updateItem.mutateAsync({ recipeId: recipe.id, itemId: id, input }),
    [updateItem, recipe.id],
  );

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
            <div className="sub">Add supplies, preparations, or modifier groups below.</div>
          </div>
        ) : (
          items.map((it, idx) => (
            <RecipeItemRow
              key={it.id}
              item={it}
              even={idx % 2 === 0}
              onDelete={handleDelete}
              deleting={deleteItem.isPending}
              onUpdate={handleUpdate}
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
  if (it.modifier_group_id && it.modifier_group) {
    // Cost the slot against the is_default modifier's supply at ratio 1.0 —
    // mirrors the backend cost engine so the preview matches what the server
    // persists.
    const def = it.modifier_group.modifiers?.find((m) => m.is_default);
    if (!def?.supply) return null;
    return estimateSupplyItemCost({
      quantity: qty,
      recipeUnit: it.unit,
      wastePct: waste,
      contentPerUnit:
        def.supply.content_per_unit != null ? Number(def.supply.content_per_unit) : null,
      contentUnit: def.supply.content_unit,
      averageCost: Number(def.supply.average_cost),
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
  onDelete: (id: string) => void;
  deleting: boolean;
  onUpdate: (
    id: string,
    input: { quantity?: number; waste_pct?: number },
  ) => Promise<unknown>;
}

const RecipeItemRow = memo(function RecipeItemRow({
  item,
  even,
  onDelete,
  deleting,
  onUpdate,
}: RecipeItemRowProps) {
  // Optimistic adds use tmp_ ids before the POST resolves — any
  // PATCH/DELETE against them would 404. Gate the row's mutations.
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
  // For slots, show the group name up top with the 🔄 badge and surface the
  // default modifier (the fallback when the customer picks nothing) below.
  const defaultMod = item.modifier_group?.modifiers?.find((m) => m.is_default);
  const label =
    kind === 'modifier'
      ? item.modifier_group?.name ?? 'Modifier group'
      : item.supply?.name ?? item.preparation?.name ?? 'Unknown';
  return (
    <div
      className={`table-row ${even ? 'even' : 'odd'}`}
      style={{
        gridTemplateColumns: '2fr 110px 100px 90px 130px 40px',
        cursor: 'default',
      }}
    >
      <div>
        <div className="fw-600 fs-13">
          {kind === 'modifier' && (
            <span style={{ marginRight: 6 }} title="Modifier group slot">🔄</span>
          )}
          {label}
        </div>
        <div className="fs-11 text-muted mt-4">
          {kind === 'modifier' ? (
            <Badge tone="gold">Modifier group</Badge>
          ) : kind === 'preparation' ? (
            <Badge tone="gold">Preparation</Badge>
          ) : (
            <Badge tone="gray">Supply</Badge>
          )}
          {kind === 'modifier' && defaultMod?.supply?.name && (
            <span className="text-muted" style={{ marginLeft: 8 }}>
              default: {defaultMod.supply.name}
            </span>
          )}
          {kind === 'modifier' && !defaultMod && (
            <span className="text-red" style={{ marginLeft: 8 }}>
              · no default set
            </span>
          )}
        </div>
      </div>
      <div>
        <InlineNumberCell
          value={item.quantity}
          min={0}
          step="any"
          validate={(n) => (n > 0 ? null : 'Must be positive')}
          onSave={(n) => handleUpdate({ quantity: n })}
        />
      </div>
      <div className="fs-13 text-muted">{item.unit}</div>
      <div>
        <InlineNumberCell
          value={item.waste_pct}
          min={0}
          max={99}
          step="any"
          emptyAs={0}
          validate={(n) => (n >= 0 && n < 100 ? null : '0–99')}
          onSave={(n) => handleUpdate({ waste_pct: n })}
        />
      </div>
      <div className="fs-13 fw-600">
        {estCost != null ? formatMoney(estCost) : <span className="text-muted">—</span>}
      </div>
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => onDelete(item.id)}
          disabled={deleting || isTemp}
          title="Remove"
          aria-label="Remove item"
        >
          ✕
        </button>
      </div>
    </div>
  );
});

/* ───────────────────────────────────────────────────────── */

interface InlineNumberCellProps {
  value: string;
  min?: number;
  max?: number;
  step?: string;
  /** When the field is cleared, write this value instead of failing. */
  emptyAs?: number;
  validate?: (n: number) => string | null;
  onSave: (n: number) => Promise<unknown>;
}

function InlineNumberCell({
  value,
  min,
  max,
  step = 'any',
  emptyAs,
  validate,
  onSave,
}: InlineNumberCellProps) {
  const [draft, setDraft] = useState<string>(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = async () => {
    if (saving) return;
    let next: number;
    if (draft.trim() === '') {
      if (emptyAs === undefined) {
        setError('Required');
        setDraft(value);
        return;
      }
      next = emptyAs;
    } else {
      next = Number(draft);
      if (!Number.isFinite(next)) {
        setError('Invalid number');
        return;
      }
    }
    const validationError = validate?.(next);
    if (validationError) {
      setError(validationError);
      return;
    }
    // No-op when the value hasn't changed — avoids an unnecessary PATCH.
    if (Number(value) === next) {
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <input
        type="number"
        className={`inline-input${error ? ' error' : ''}${saving ? ' saving' : ''}`}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setError(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {error && <div className="inline-cell-error">{error}</div>}
    </div>
  );
}

/* ───────────────────────────────────────────────────────── */

type AddKind = 'supply' | 'preparation' | 'modifier';

interface AddFormProps {
  onAdd: (input: {
    supply_id?: string | null;
    preparation_id?: string | null;
    modifier_group_id?: string | null;
    quantity: number;
    unit: string;
    waste_pct?: number;
  }) => Promise<unknown>;
  /** Forbid a preparation from referencing itself as an ingredient. */
  excludePreparationId?: string;
}

function AddRecipeItemForm({ onAdd, excludePreparationId }: AddFormProps) {
  const [kind, setKind] = useState<AddKind>('supply');
  const [entityId, setEntityId] = useState<string>('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<RecipeUnit | ''>('');
  const [wastePct, setWastePct] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Clear the currently-selected entity when switching kind so stale IDs
  // from the other list don't submit.
  const switchKind = (next: AddKind) => {
    setKind(next);
    setEntityId('');
    setErrors({});
    setServerError(null);
  };

  const suppliesQ = useSupplies({ active: true });
  const prepsQ = useProducts({ type: 'PREPARATION', active: true });
  // The modifier picker lists SWAP groups only — ADD groups stack on top of
  // the recipe at sale time and don't belong on the recipe line itself.
  const groupsQ = useModifierGroups({});

  // SWAP groups attachable to a recipe must have an is_default modifier —
  // the deduction engine needs that fallback when the customer picks nothing.
  // Groups without one are surfaced as disabled below.
  const swapGroups = useMemo(() => {
    const items = groupsQ.data?.items ?? [];
    return items.filter((g) => g.type === 'SWAP');
  }, [groupsQ.data]);

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
      const items = suppliesQ.data?.pages.flatMap((p) => p.items) ?? [];
      return items.map((s) => ({ value: s.id, label: s.name }));
    }
    if (kind === 'preparation') {
      const items = prepsQ.data?.pages.flatMap((p) => p.items) ?? [];
      return items
        .filter((p) => p.id !== excludePreparationId)
        .map((p) => ({ value: p.id, label: p.name }));
    }
    return swapGroups.map((g) => {
      const def = g.modifiers?.find((m) => m.is_default);
      if (!def) return { value: g.id, label: `${g.name} — no default set` };
      // supply is embedded via the list endpoint; fall back to the modifier
      // name if the include ever drops it so the option still labels usefully.
      const defaultLabel = def.supply?.name ?? def.name;
      return { value: g.id, label: `${g.name} — default ${defaultLabel}` };
    });
  }, [
    kind,
    suppliesQ.data,
    prepsQ.data,
    swapGroups,
    excludePreparationId,
  ]);

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
      e.entityId =
        kind === 'modifier' ? 'Select a modifier group' : `Select a ${kind}`;
    }
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
      if (kind === 'modifier') {
        if (!selectedGroup) {
          throw new Error('Modifier group is no longer available');
        }
        // is_default is the real gate — the backend rejects is_default=true
        // without a supply_id, so a defaulted modifier is guaranteed to have
        // a supply even if the list include doesn't embed it.
        if (!selectedGroupDefault) {
          throw new Error(
            'This modifier group has no default modifier yet. Set one in the modifier group page before attaching it to a recipe.',
          );
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
      setServerError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setAdding(false);
    }
  };

  const entityLabel =
    kind === 'supply'
      ? 'Supply'
      : kind === 'preparation'
        ? 'Preparation'
        : 'Modifier group';

  const emptyHint =
    kind === 'modifier'
      ? 'No SWAP groups available'
      : `No ${kind}s available`;

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
        <button
          type="button"
          className={`filter-pill ${kind === 'modifier' ? 'active' : ''}`}
          onClick={() => switchKind('modifier')}
        >
          Modifier
        </button>
      </div>

      {kind === 'modifier' && selectedGroup && (
        <div
          className="fs-11 text-muted mb-8"
          style={{ background: 'var(--bg)', padding: '6px 10px', borderRadius: 4 }}
        >
          {selectedGroupDefault ? (
            <>
              🔄 This line is a slot filled by <strong>{selectedGroup.name}</strong>{' '}
              at the POS. Defaults to{' '}
              <strong>
                {selectedGroupDefault.supply?.name ?? selectedGroupDefault.name}
              </strong>{' '}
              when the customer picks nothing.
            </>
          ) : (
            <span className="text-red">
              ⚠ <strong>{selectedGroup.name}</strong> has no default modifier
              yet. Mark one modifier in the group as Default before attaching
              it to a recipe.
            </span>
          )}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
          gap: 10,
          alignItems: 'start',
        }}
      >
        <Select
          label={entityLabel}
          name="entityId"
          value={entityId}
          onValueChange={setEntityId}
          placeholder={
            loadingEntities
              ? 'Loading…'
              : entityOptions.length === 0
                ? emptyHint
                : 'Select…'
          }
          options={entityOptions}
          error={errors.entityId}
          disabled={loadingEntities || entityOptions.length === 0}
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
