// Recipes — fetched by product or variant. The owner type drives the path.
// GET returns null when no recipe exists yet (404 is normalised so the UI can
// show an empty state). Items are created/updated through the recipe id.

import { api, ApiError } from './client';
import type {
  CreateRecipeInput,
  CreateRecipeItemInput,
  Recipe,
  RecipeItem,
  UpdateRecipeInput,
  UpdateRecipeItemInput,
} from './products';

export type RecipeOwner =
  | { kind: 'product'; id: string }
  | { kind: 'variant'; id: string };

export async function getRecipeForOwner(owner: RecipeOwner): Promise<Recipe | null> {
  const path =
    owner.kind === 'product'
      ? `/recipes/products/${owner.id}`
      : `/recipes/variants/${owner.id}`;
  try {
    return await api.get<Recipe>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function createRecipeForOwner(
  owner: RecipeOwner,
  input: CreateRecipeInput = {},
): Promise<Recipe> {
  const path =
    owner.kind === 'product'
      ? `/recipes/products/${owner.id}`
      : `/recipes/variants/${owner.id}`;
  return api.post<Recipe>(path, input);
}

export function updateRecipe(id: string, input: UpdateRecipeInput): Promise<Recipe> {
  return api.patch<Recipe>(`/recipes/${id}`, input);
}

export function deleteRecipe(id: string): Promise<void> {
  return api.delete<void>(`/recipes/${id}`);
}

export function recalculateRecipe(
  id: string,
): Promise<{ recipe_id: string; recipe_cost: string }> {
  return api.post<{ recipe_id: string; recipe_cost: string }>(
    `/recipes/${id}/recalculate`,
  );
}

export function addRecipeItem(
  recipeId: string,
  input: CreateRecipeItemInput,
): Promise<RecipeItem> {
  return api.post<RecipeItem>(`/recipes/${recipeId}/items`, input);
}

export function updateRecipeItem(
  recipeId: string,
  itemId: string,
  input: UpdateRecipeItemInput,
): Promise<RecipeItem> {
  return api.patch<RecipeItem>(`/recipes/${recipeId}/items/${itemId}`, input);
}

export function deleteRecipeItem(recipeId: string, itemId: string): Promise<void> {
  return api.delete<void>(`/recipes/${recipeId}/items/${itemId}`);
}

// Raw-supply ingredient list for a product/variant, with preparations expanded.
// Used by the Log Waste flow to pre-fill a multi-line waste ticket from a tap.
export interface ResolvedIngredient {
  supply_id: string;
  supply_name: string;
  base_unit: string;
  content_per_unit: string | null;
  content_unit: string | null;
  base_qty: string;
  content_qty: string | null;
}

export function fetchRecipeIngredients(
  productId: string,
  variantId?: string | null,
): Promise<ResolvedIngredient[]> {
  const sp = new URLSearchParams();
  sp.set('product_id', productId);
  if (variantId) sp.set('variant_id', variantId);
  return api.get<ResolvedIngredient[]>(`/recipes/ingredients?${sp.toString()}`);
}
