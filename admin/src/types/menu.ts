/**
 * Types mirroring the backend Prisma models for the menu side (products,
 * categories, variants, modifiers, recipes, product modifications).
 *
 * Decimal fields come over the wire as strings (Prisma serialization). We
 * keep them as strings in the types and convert with Number() at the edge.
 */

import type { BaseUnit, ContentUnit } from './inventory';

export type ModifierGroupType = 'SWAP' | 'ADD';
export type ModifierOverrideType = 'RATIO' | 'FIXED_QTY';

export type ProductType = 'PRODUCT' | 'DISH' | 'PREPARATION';
export const PRODUCT_TYPES: ProductType[] = ['PRODUCT', 'DISH', 'PREPARATION'];

export function productTypeLabel(t: ProductType): string {
  switch (t) {
    case 'PRODUCT':     return 'Product';
    case 'DISH':        return 'Dish';
    case 'PREPARATION': return 'Preparation';
  }
}

/* ── Categories ─────────────────────────────────────────── */

export interface ProductCategory {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  color: string | null;
  display_order: number;
  visible_in_pos: boolean;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  children?: { id: string; name: string }[];
  parent?: ProductCategory | null;
}

export interface CreateCategoryInput {
  name: string;
  description?: string | null;
  image_url?: string | null;
  color?: string | null;
  display_order?: number;
  visible_in_pos?: boolean;
  parent_id?: string | null;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

/* ── Products ───────────────────────────────────────────── */

export interface Tax {
  id: string;
  name: string;
  rate: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  sell_price: string;
  barcode: string | null;
  recipe_cost: string;
  food_cost_pct: string;
  display_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ModifierGroupLink {
  id: string;
  product_id: string;
  modifier_group_id: string;
  modifier_group: ModifierGroup;
}

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  category_id: string | null;
  station_id: string | null;
  sell_price: string | null;
  recipe_cost: string;
  food_cost_pct: string;
  markup: string;
  image_url: string | null;
  icon_color: string | null;
  display_order: number;
  active: boolean;
  allow_discount: boolean;
  sold_by_weight: boolean;
  barcode: string | null;
  tax_id: string | null;
  supply_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;

  category?: ProductCategory | null;
  tax?: Tax | null;
  supply?: { id: string; name: string; base_unit: BaseUnit } | null;
  variants?: ProductVariant[];
  modifier_groups?: ModifierGroupLink[];
}

export interface CreateProductInput {
  name: string;
  type: ProductType;
  category_id?: string | null;
  station_id?: string | null;
  sell_price?: number | null;
  image_url?: string | null;
  icon_color?: string | null;
  display_order?: number;
  active?: boolean;
  allow_discount?: boolean;
  sold_by_weight?: boolean;
  barcode?: string | null;
  tax_id?: string | null;
  supply_id?: string | null;
}

export type UpdateProductInput = Partial<CreateProductInput>;

/* ── Variants ───────────────────────────────────────────── */

export interface CreateVariantInput {
  name: string;
  sell_price: number;
  barcode?: string | null;
  display_order?: number;
  active?: boolean;
}

export type UpdateVariantInput = Partial<CreateVariantInput>;

/* ── Modifier Groups & Modifiers ────────────────────────── */

export interface Modifier {
  id: string;
  group_id: string;
  name: string;
  extra_price: string;
  supply_id: string | null;
  supply_quantity: string | null;
  supply_unit: string | null;
  ratio: string;
  is_default: boolean;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  supply?: { id: string; name: string; content_unit: ContentUnit | null } | null;
}

export interface ModifierGroup {
  id: string;
  name: string;
  type: ModifierGroupType;
  min_selection: number;
  max_selection: number;
  required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  modifiers?: Modifier[];
  _count?: { product_links: number };
}

export interface CreateModifierGroupInput {
  name: string;
  type?: ModifierGroupType;
  min_selection?: number;
  max_selection?: number;
  required?: boolean;
  display_order?: number;
}

export type UpdateModifierGroupInput = Partial<CreateModifierGroupInput>;

export interface CreateModifierInput {
  name: string;
  extra_price?: number;
  supply_id?: string | null;
  supply_quantity?: number | null;
  supply_unit?: string | null;
  ratio?: number;
  is_default?: boolean;
  active?: boolean;
  display_order?: number;
}

export type UpdateModifierInput = Partial<CreateModifierInput>;

/* ── Modifier Product Overrides ─────────────────────────── */

export interface ModifierProductOverride {
  id: string;
  product_id: string;
  modifier_id: string;
  override_type: ModifierOverrideType;
  override_ratio: string | null;
  override_quantity: string | null;
  override_unit: string | null;
  created_at: string;
  updated_at: string;
  modifier?: {
    id: string;
    name: string;
    group_id: string;
    group?: { id: string; name: string; type: ModifierGroupType };
  };
  product?: { id: string; name: string };
}

export interface CreateOverrideInput {
  modifier_id: string;
  override_type: ModifierOverrideType;
  override_ratio?: number | null;
  override_quantity?: number | null;
  override_unit?: string | null;
}

export interface UpdateOverrideInput {
  override_type?: ModifierOverrideType;
  override_ratio?: number | null;
  override_quantity?: number | null;
  override_unit?: string | null;
}

export interface LinkedProduct {
  id: string;
  name: string;
  type: ProductType;
  active: boolean;
  sell_price: string | null;
  category: { id: string; name: string } | null;
}

/* ── Product Modifications (for PRODUCT type) ───────────── */

export interface ProductModification {
  id: string;
  product_id: string;
  name: string;
  sell_price: string;
  barcode: string | null;
  supply_id: string | null;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  supply?: { id: string; name: string; base_unit: BaseUnit } | null;
}

export interface CreateModificationInput {
  name: string;
  sell_price: number;
  barcode?: string | null;
  supply_id?: string | null;
  active?: boolean;
  display_order?: number;
}

export type UpdateModificationInput = Partial<CreateModificationInput>;

/* ── Recipes ────────────────────────────────────────────── */

export const RECIPE_UNITS = ['ml', 'l', 'g', 'kg', 'oz', 'fl_oz', 'piece', 'unit'] as const;
export type RecipeUnit = (typeof RECIPE_UNITS)[number];

export interface RecipeItem {
  id: string;
  recipe_id: string;
  supply_id: string | null;
  preparation_id: string | null;
  modifier_group_id: string | null;
  quantity: string;
  unit: string;
  waste_pct: string;
  created_at: string;
  supply?: {
    id: string;
    name: string;
    content_per_unit: string | null;
    content_unit: ContentUnit | null;
    average_cost: string;
  } | null;
  preparation?: {
    id: string;
    name: string;
    type: ProductType;
    recipe_cost: string;
  } | null;
  modifier_group?: {
    id: string;
    name: string;
    type: ModifierGroupType;
    modifiers?: {
      id: string;
      name: string;
      is_default: boolean;
      ratio: string;
      supply?: {
        id: string;
        name: string;
        content_per_unit: string | null;
        content_unit: ContentUnit | null;
        average_cost: string;
      } | null;
    }[];
  } | null;
}

export interface Recipe {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  yield_quantity: string | null;
  yield_unit: string | null;
  created_at: string;
  updated_at: string;
  items: RecipeItem[];
}

export interface CreateRecipeInput {
  yield_quantity?: number | null;
  yield_unit?: string | null;
  items?: CreateRecipeItemInput[];
}

export interface UpdateRecipeInput {
  yield_quantity?: number | null;
  yield_unit?: string | null;
}

export interface CreateRecipeItemInput {
  supply_id?: string | null;
  preparation_id?: string | null;
  modifier_group_id?: string | null;
  quantity: number;
  unit: string;
  waste_pct?: number;
}

export type UpdateRecipeItemInput = Partial<CreateRecipeItemInput>;
