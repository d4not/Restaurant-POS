// Client-side recipe-line cost estimator. Mirrors the backend cost engine at
// src/modules/recipes/cost-engine.ts so the recipe editor can preview a
// line's cost as the user types. The backend is always authoritative — the
// total displayed at the recipe footer is the cached recipe_cost from the
// owning product/variant.

import type { ContentUnit } from '../api/products';

// Canonical family units: ml for volume, g for weight. Rates match the
// server's UNIT_ALIASES + VOLUME_TO_ML / WEIGHT_TO_G tables exactly.
const VOLUME_TO_ML: Record<string, number> = {
  ML: 1,
  L: 1000,
  FL_OZ: 29.5735,
};

const WEIGHT_TO_G: Record<string, number> = {
  G: 1,
  KG: 1000,
  OZ: 28.3495,
};

const ALIASES: Record<string, ContentUnit | 'PIECE'> = {
  ml: 'ML', milliliter: 'ML', milliliters: 'ML',
  l: 'L', liter: 'L', liters: 'L',
  g: 'G', gram: 'G', grams: 'G',
  kg: 'KG', kilogram: 'KG', kilograms: 'KG',
  oz: 'OZ', ounce: 'OZ', ounces: 'OZ',
  'fl oz': 'FL_OZ', fl_oz: 'FL_OZ', floz: 'FL_OZ',
  'fluid ounce': 'FL_OZ', 'fluid ounces': 'FL_OZ',
  piece: 'PIECE', pieces: 'PIECE', pc: 'PIECE', pcs: 'PIECE',
  unit: 'PIECE', units: 'PIECE',
};

function normalize(raw: string): ContentUnit | 'PIECE' | null {
  return ALIASES[raw.trim().toLowerCase()] ?? null;
}

function family(u: ContentUnit | 'PIECE'): 'volume' | 'weight' | 'piece' | null {
  if (u === 'PIECE') return 'piece';
  if (VOLUME_TO_ML[u] !== undefined) return 'volume';
  if (WEIGHT_TO_G[u] !== undefined) return 'weight';
  return null;
}

function convert(qty: number, from: ContentUnit, to: ContentUnit): number | null {
  if (from === to) return qty;
  const fromFam = family(from);
  const toFam = family(to);
  if (fromFam !== toFam) return null;
  const table = fromFam === 'volume' ? VOLUME_TO_ML : WEIGHT_TO_G;
  return (qty * table[from]) / table[to];
}

/**
 * Approximate line cost for a supply ingredient. Returns null if the units
 * can't be reconciled (e.g. recipe uses ml against a piece-only supply).
 */
export function estimateSupplyItemCost(args: {
  quantity: number;
  recipeUnit: string;
  wastePct: number;
  contentPerUnit: number | null;
  contentUnit: ContentUnit | null;
  averageCost: number; // centavos per base unit
}): number | null {
  const { quantity, recipeUnit, wastePct, contentPerUnit, contentUnit, averageCost } = args;
  const normalized = normalize(recipeUnit);
  if (!normalized) return null;

  let baseQty: number;
  const hasMeasurable = contentPerUnit != null && contentUnit != null;

  if (hasMeasurable) {
    if (contentPerUnit! <= 0) return null;
    if (normalized === 'PIECE') return null;
    const qtyInContentUnit = convert(quantity, normalized, contentUnit!);
    if (qtyInContentUnit == null) return null;
    baseQty = qtyInContentUnit / contentPerUnit!;
  } else {
    if (normalized !== 'PIECE') return null;
    baseQty = quantity;
  }

  const wasteFactor = 1 - wastePct / 100;
  if (wasteFactor <= 0) return null;
  return (baseQty / wasteFactor) * averageCost;
}

/**
 * Approximate preparation line cost when we know the prep's yield + total
 * recipe cost. Returns null when we can't reconcile units.
 */
export function estimatePreparationItemCost(args: {
  quantity: number;
  recipeUnit: string;
  wastePct: number;
  yieldQuantity: number | null;
  yieldUnit: string | null;
  preparationRecipeCost: number;
}): number | null {
  const { quantity, recipeUnit, wastePct, yieldQuantity, yieldUnit, preparationRecipeCost } = args;
  if (yieldQuantity == null || yieldUnit == null || yieldQuantity <= 0) return null;

  const normalizedRecipe = normalize(recipeUnit);
  const normalizedYield = normalize(yieldUnit);
  if (!normalizedRecipe || !normalizedYield) return null;

  let qtyInYield: number | null;
  if (normalizedRecipe === 'PIECE' || normalizedYield === 'PIECE') {
    if (normalizedRecipe !== normalizedYield) return null;
    qtyInYield = quantity;
  } else {
    qtyInYield = convert(quantity, normalizedRecipe, normalizedYield);
  }
  if (qtyInYield == null) return null;

  const wasteFactor = 1 - wastePct / 100;
  if (wasteFactor <= 0) return null;
  return (qtyInYield / yieldQuantity / wasteFactor) * preparationRecipeCost;
}
