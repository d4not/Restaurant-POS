// Recipe hooks. Owner is product or variant; the cache key encodes both so a
// dish's product-level recipe and its variant-level recipes coexist. Every
// recipe mutation also invalidates the parent product since recipe_cost /
// food_cost_pct / markup are denormalised on the product/variant row.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addRecipeItem,
  createRecipeForOwner,
  deleteRecipeItem,
  getRecipeForOwner,
  recalculateRecipe,
  updateRecipe,
  updateRecipeItem,
  type RecipeOwner,
} from '../api/recipes';
import type {
  CreateRecipeInput,
  CreateRecipeItemInput,
  Recipe,
  UpdateRecipeInput,
  UpdateRecipeItemInput,
} from '../api/products';

function ownerKey(owner: RecipeOwner): readonly unknown[] {
  return ['admin', 'recipe', owner.kind, owner.id] as const;
}

function ownerProductId(owner: RecipeOwner): string | null {
  return owner.kind === 'product' ? owner.id : null;
}

export function useRecipe(owner: RecipeOwner) {
  return useQuery<Recipe | null>({
    queryKey: ownerKey(owner),
    queryFn: () => getRecipeForOwner(owner),
    staleTime: 30_000,
  });
}

export function useCreateRecipe(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecipeInput = {}) =>
      createRecipeForOwner(owner, input),
    onSuccess: (recipe) => {
      qc.setQueryData(ownerKey(owner), recipe);
      const productId = ownerProductId(owner) ?? recipe.product_id ?? null;
      if (productId) {
        qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
      }
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
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
      input: UpdateRecipeInput;
    }) => updateRecipe(recipeId, input),
    onSuccess: (recipe) => {
      qc.setQueryData(ownerKey(owner), recipe);
      const productId = ownerProductId(owner) ?? recipe.product_id ?? null;
      if (productId) {
        qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
      }
    },
  });
}

export function useAddRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      recipeId,
      input,
    }: {
      recipeId: string;
      input: CreateRecipeItemInput;
    }) => addRecipeItem(recipeId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ownerKey(owner) });
      const productId = ownerProductId(owner);
      if (productId) {
        qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
      }
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });
}

export function useUpdateRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      recipeId,
      itemId,
      input,
    }: {
      recipeId: string;
      itemId: string;
      input: UpdateRecipeItemInput;
    }) => updateRecipeItem(recipeId, itemId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ownerKey(owner) });
      const productId = ownerProductId(owner);
      if (productId) {
        qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
      }
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });
}

export function useDeleteRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recipeId, itemId }: { recipeId: string; itemId: string }) =>
      deleteRecipeItem(recipeId, itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ownerKey(owner) });
      const productId = ownerProductId(owner);
      if (productId) {
        qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
      }
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });
}

export function useRecalculateRecipe() {
  return useMutation({
    mutationFn: (recipeId: string) => recalculateRecipe(recipeId),
  });
}
