import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  addRecipeItem,
  createProductRecipe,
  createVariantRecipe,
  deleteRecipe,
  deleteRecipeItem,
  getProductRecipe,
  getVariantRecipe,
  updateRecipe,
  updateRecipeItem,
} from '../api/recipes';
import type {
  ModifierGroup,
  Product,
  Recipe,
  RecipeItem,
} from '../types/menu';
import type { Supply } from '../types/inventory';
import type { Paginated } from '../types/api';

type RecipeOwner =
  | { kind: 'product'; id: string }
  | { kind: 'variant'; id: string };

function ownerKey(owner: RecipeOwner | undefined): readonly unknown[] {
  if (!owner) return ['recipe', 'none'];
  return owner.kind === 'product'
    ? ['recipe', 'product', owner.id]
    : ['recipe', 'variant', owner.id];
}

function fetchRecipeByOwner(owner: RecipeOwner) {
  return owner.kind === 'product'
    ? getProductRecipe(owner.id)
    : getVariantRecipe(owner.id);
}

function invalidationsFor(owner: RecipeOwner): unknown[][] {
  // Pre-flight check: ProductsPage list rows DO display recipe_cost (line 78) and
  // food_cost_pct (lines 64, 155), so changing a recipe shifts those visible
  // figures on the list. Keep the ['products'] invalidation — narrowing it would
  // leave the list out of sync until the next page refresh.
  return [
    ownerKey(owner) as unknown[],
    owner.kind === 'product'
      ? ['product', owner.id]
      : ['product', 'by-variant', owner.id],
    ['products'],
  ];
}

/* ── Optimistic display-ref lookups ─────────────────────── */

// Pull a Supply from any cached single or paginated list query so the
// optimistic RecipeItem row can render its name/cost immediately. Returns the
// trimmed shape the RecipeItem type expects.
function lookupSupplyFromCache(qc: QueryClient, id: string): RecipeItem['supply'] {
  const single = qc.getQueryData<Supply>(['supply', id]);
  if (single) {
    return {
      id: single.id,
      name: single.name,
      content_per_unit: single.content_per_unit,
      content_unit: single.content_unit,
      average_cost: single.average_cost,
    };
  }
  type InfData = { pages: Array<Paginated<Supply>>; pageParams: unknown[] };
  const lists = qc.getQueriesData<InfData>({ queryKey: ['supplies'] });
  for (const [, data] of lists) {
    if (!data) continue;
    for (const page of data.pages) {
      const found = page.items.find((s) => s.id === id);
      if (found) {
        return {
          id: found.id,
          name: found.name,
          content_per_unit: found.content_per_unit,
          content_unit: found.content_unit,
          average_cost: found.average_cost,
        };
      }
    }
  }
  return null;
}

// Preparations are Products with type=PREPARATION. Pull from either the
// single-product cache or the paginated products list.
function lookupPrepFromCache(qc: QueryClient, id: string): RecipeItem['preparation'] {
  const single = qc.getQueryData<Product>(['product', id]);
  if (single) {
    return {
      id: single.id,
      name: single.name,
      type: single.type,
      recipe_cost: single.recipe_cost,
    };
  }
  type InfData = { pages: Array<Paginated<Product>>; pageParams: unknown[] };
  const lists = qc.getQueriesData<InfData>({ queryKey: ['products'] });
  for (const [, data] of lists) {
    if (!data) continue;
    for (const page of data.pages) {
      const found = page.items.find((p) => p.id === id);
      if (found) {
        return {
          id: found.id,
          name: found.name,
          type: found.type,
          recipe_cost: found.recipe_cost,
        };
      }
    }
  }
  return null;
}

// Modifier groups are paginated (not infinite — useQuery), so the data sits at
// `data.items` rather than `data.pages[].items`.
function lookupGroupFromCache(
  qc: QueryClient,
  id: string,
): RecipeItem['modifier_group'] {
  const single = qc.getQueryData<ModifierGroup>(['modifier-group', id]);
  if (single) {
    return {
      id: single.id,
      name: single.name,
      type: single.type,
      modifiers: single.modifiers?.map((m) => ({
        id: m.id,
        name: m.name,
        is_default: m.is_default,
        ratio: m.ratio,
        supply: m.supply
          ? {
              id: m.supply.id,
              name: m.supply.name,
              content_per_unit: null,
              content_unit: m.supply.content_unit,
              average_cost: '0',
            }
          : null,
      })),
    };
  }
  const lists = qc.getQueriesData<Paginated<ModifierGroup>>({
    queryKey: ['modifier-groups'],
  });
  for (const [, data] of lists) {
    if (!data) continue;
    const found = data.items.find((g) => g.id === id);
    if (found) {
      return {
        id: found.id,
        name: found.name,
        type: found.type,
        modifiers: found.modifiers?.map((m) => ({
          id: m.id,
          name: m.name,
          is_default: m.is_default,
          ratio: m.ratio,
          supply: m.supply
            ? {
                id: m.supply.id,
                name: m.supply.name,
                content_per_unit: null,
                content_unit: m.supply.content_unit,
                average_cost: '0',
              }
            : null,
        })),
      };
    }
  }
  return null;
}

/* ── Queries ────────────────────────────────────────────── */

export function useRecipe(owner: RecipeOwner | undefined) {
  return useQuery({
    queryKey: ownerKey(owner),
    queryFn: () => fetchRecipeByOwner(owner as RecipeOwner),
    enabled: !!owner,
  });
}

export function useCreateRecipe(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createProductRecipe>[1]) =>
      owner.kind === 'product'
        ? createProductRecipe(owner.id, input)
        : createVariantRecipe(owner.id, input),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useUpdateRecipe(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      recipeId,
      input,
    }: {
      recipeId: string;
      input: Parameters<typeof updateRecipe>[1];
    }) => updateRecipe(recipeId, input),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useDeleteRecipe(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string) => deleteRecipe(recipeId),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/* ── Recipe item mutations (optimistic, filter-rollback) ─── */

export function useAddRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  const recipeKey = ownerKey(owner);
  return useMutation({
    mutationFn: ({
      recipeId,
      input,
    }: {
      recipeId: string;
      input: Parameters<typeof addRecipeItem>[1];
    }) => addRecipeItem(recipeId, input),
    onMutate: async ({ recipeId, input }) => {
      await qc.cancelQueries({ queryKey: recipeKey });
      const tempId = `tmp_${crypto.randomUUID()}`;
      const supply = input.supply_id
        ? lookupSupplyFromCache(qc, input.supply_id)
        : null;
      const preparation = input.preparation_id
        ? lookupPrepFromCache(qc, input.preparation_id)
        : null;
      const modifier_group = input.modifier_group_id
        ? lookupGroupFromCache(qc, input.modifier_group_id)
        : null;
      const optimistic: RecipeItem = {
        id: tempId,
        recipe_id: recipeId,
        supply_id: input.supply_id ?? null,
        preparation_id: input.preparation_id ?? null,
        modifier_group_id: input.modifier_group_id ?? null,
        quantity: String(input.quantity),
        unit: input.unit,
        waste_pct: String(input.waste_pct ?? 0),
        created_at: new Date().toISOString(),
        supply,
        preparation,
        modifier_group,
      };
      qc.setQueryData<Recipe | null | undefined>(recipeKey, (old) =>
        old ? { ...old, items: [...old.items, optimistic] } : old,
      );
      return { tempId };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      qc.setQueryData<Recipe | null | undefined>(recipeKey, (old) =>
        old
          ? { ...old, items: old.items.filter((it) => it.id !== ctx.tempId) }
          : old,
      );
    },
    onSuccess: (server, _v, ctx) => {
      if (!ctx) return;
      // Keep the locally-resolved display refs (supply/preparation/modifier_group)
      // even after the server replies — the server response only carries the FK
      // ids, but the UI rows need the joined display objects.
      qc.setQueryData<Recipe | null | undefined>(recipeKey, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                it.id === ctx.tempId
                  ? {
                      ...server,
                      supply: it.supply,
                      preparation: it.preparation,
                      modifier_group: it.modifier_group,
                    }
                  : it,
              ),
            }
          : old,
      );
    },
    onSettled: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useUpdateRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  const recipeKey = ownerKey(owner);
  return useMutation({
    mutationFn: ({
      recipeId,
      itemId,
      input,
    }: {
      recipeId: string;
      itemId: string;
      input: Parameters<typeof updateRecipeItem>[2];
    }) => updateRecipeItem(recipeId, itemId, input),
    onMutate: async ({ itemId, input }) => {
      await qc.cancelQueries({ queryKey: recipeKey });
      const current = qc.getQueryData<Recipe | null | undefined>(recipeKey);
      const prevItem = current?.items.find((it) => it.id === itemId);
      qc.setQueryData<Recipe | null | undefined>(recipeKey, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                it.id === itemId
                  ? {
                      ...it,
                      ...(input.quantity !== undefined
                        ? { quantity: String(input.quantity) }
                        : {}),
                      ...(input.unit !== undefined ? { unit: input.unit } : {}),
                      ...(input.waste_pct !== undefined
                        ? { waste_pct: String(input.waste_pct) }
                        : {}),
                    }
                  : it,
              ),
            }
          : old,
      );
      return { itemId, prevItem };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx?.prevItem) return;
      qc.setQueryData<Recipe | null | undefined>(recipeKey, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                it.id === ctx.itemId ? ctx.prevItem! : it,
              ),
            }
          : old,
      );
    },
    onSuccess: (server, _v, ctx) => {
      if (!ctx) return;
      qc.setQueryData<Recipe | null | undefined>(recipeKey, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                it.id === ctx.itemId
                  ? {
                      ...server,
                      // Keep locally-known display refs unless the server provided one.
                      supply: it.supply,
                      preparation: it.preparation,
                      modifier_group: it.modifier_group,
                    }
                  : it,
              ),
            }
          : old,
      );
    },
    onSettled: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useDeleteRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  const recipeKey = ownerKey(owner);
  return useMutation({
    mutationFn: ({ recipeId, itemId }: { recipeId: string; itemId: string }) =>
      deleteRecipeItem(recipeId, itemId),
    onMutate: async ({ itemId }) => {
      await qc.cancelQueries({ queryKey: recipeKey });
      const current = qc.getQueryData<Recipe | null | undefined>(recipeKey);
      const idx = current?.items.findIndex((it) => it.id === itemId) ?? -1;
      const prevItem = idx >= 0 ? current!.items[idx] : null;
      qc.setQueryData<Recipe | null | undefined>(recipeKey, (old) =>
        old ? { ...old, items: old.items.filter((it) => it.id !== itemId) } : old,
      );
      return { itemId, idx, prevItem };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx?.prevItem || ctx.idx < 0) return;
      qc.setQueryData<Recipe | null | undefined>(recipeKey, (old) => {
        if (!old) return old;
        const items = [...old.items];
        items.splice(ctx.idx, 0, ctx.prevItem!);
        return { ...old, items };
      });
    },
    onSettled: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
