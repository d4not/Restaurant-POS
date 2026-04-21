import { api } from './client';
import type {
  CreateRecipeInput,
  CreateRecipeItemInput,
  Recipe,
  RecipeItem,
  UpdateRecipeInput,
  UpdateRecipeItemInput,
} from '../types/menu';

/* ── Recipe owner endpoints ─────────────────────────────── */

/**
 * Returns the recipe for a product, or null if it hasn't been created yet.
 * The backend 404s — we normalize that to `null` so the UI can show an
 * empty state instead of an error.
 */
export async function getProductRecipe(productId: string): Promise<Recipe | null> {
  try {
    return await api.get<Recipe>(`/recipes/products/${productId}`);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export async function getVariantRecipe(variantId: string): Promise<Recipe | null> {
  try {
    return await api.get<Recipe>(`/recipes/variants/${variantId}`);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export function createProductRecipe(productId: string, input: CreateRecipeInput = {}) {
  return api.post<Recipe>(`/recipes/products/${productId}`, input);
}

export function createVariantRecipe(variantId: string, input: CreateRecipeInput = {}) {
  return api.post<Recipe>(`/recipes/variants/${variantId}`, input);
}

/* ── Recipe by id ───────────────────────────────────────── */

export function getRecipe(id: string) {
  return api.get<Recipe>(`/recipes/${id}`);
}

export function updateRecipe(id: string, input: UpdateRecipeInput) {
  return api.patch<Recipe>(`/recipes/${id}`, input);
}

export function deleteRecipe(id: string) {
  return api.delete<void>(`/recipes/${id}`);
}

export function recalculateRecipe(id: string) {
  return api.post<{ recipe_id: string; recipe_cost: string }>(
    `/recipes/${id}/recalculate`,
  );
}

/* ── Recipe items ───────────────────────────────────────── */

export function addRecipeItem(recipeId: string, input: CreateRecipeItemInput) {
  return api.post<RecipeItem>(`/recipes/${recipeId}/items`, input);
}

export function updateRecipeItem(
  recipeId: string,
  itemId: string,
  input: UpdateRecipeItemInput,
) {
  return api.patch<RecipeItem>(`/recipes/${recipeId}/items/${itemId}`, input);
}

export function deleteRecipeItem(recipeId: string, itemId: string) {
  return api.delete<void>(`/recipes/${recipeId}/items/${itemId}`);
}
