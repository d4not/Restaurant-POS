import { api } from './client';
import type { PageResult } from './pagination';

/* ── Core enums + recipe units ────────────────────────────── */

export type ProductType = 'PRODUCT' | 'DISH' | 'PREPARATION';
export const PRODUCT_TYPES: ProductType[] = ['PRODUCT', 'DISH', 'PREPARATION'];

export type ModifierGroupType = 'SWAP' | 'ADD';
export type ModifierOverrideType = 'RATIO' | 'FIXED_QTY';

// Mirrors `admin/src/types/menu.ts` so the recipe editor accepts the same set.
export const RECIPE_UNITS = ['ml', 'l', 'g', 'kg', 'oz', 'fl_oz', 'piece', 'unit'] as const;
export type RecipeUnit = (typeof RECIPE_UNITS)[number];

export type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';
export type ContentUnit = 'ML' | 'L' | 'G' | 'KG' | 'OZ' | 'FL_OZ';

/* ── Variants ─────────────────────────────────────────────── */

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

/* ── Modifiers ────────────────────────────────────────────── */

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
  created_at?: string;
  updated_at?: string;
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
  modifiers: Modifier[];
  created_at?: string;
  updated_at?: string;
}

export interface ProductModifierGroupLink {
  id: string;
  product_id: string;
  modifier_group_id: string;
  modifier_group: ModifierGroup;
}

/* ── Product modifications (PRODUCT type only) ────────────── */

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

/* ── Modifier overrides (per-product) ─────────────────────── */

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
}

/* ── Recipe ───────────────────────────────────────────────── */

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

/* ── Product (full server shape) ──────────────────────────── */

export interface PosProduct {
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

  category?: { id: string; name: string } | null;
  tax?: { id: string; name: string; rate: string } | null;
  supply?: { id: string; name: string; base_unit: BaseUnit } | null;
  variants: ProductVariant[];
  modifier_groups: ProductModifierGroupLink[];
}

/* ── Create / Update input shapes ─────────────────────────── */

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

export interface CreateVariantInput {
  name: string;
  sell_price: number;
  barcode?: string | null;
  display_order?: number;
  active?: boolean;
}

export type UpdateVariantInput = Partial<CreateVariantInput>;

export interface CreateModificationInput {
  name: string;
  sell_price: number;
  barcode?: string | null;
  supply_id?: string | null;
  active?: boolean;
  display_order?: number;
}

export type UpdateModificationInput = Partial<CreateModificationInput>;

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

/* ── POS catalog fetch (used by ProductPicker, OrderHistory, TableDetail) ── */
//
// Pulls every active, sellable product. Cap at 100 per page server-side; this
// helper walks the cursor. PREPARATION rows are filtered out — they're never
// sold directly.

export async function fetchAllProducts(): Promise<PosProduct[]> {
  const out: PosProduct[] = [];
  let cursor: string | null = null;
  do {
    const qs: string[] = ['limit=100', 'active=true'];
    if (cursor) qs.push(`cursor=${cursor}`);
    const page = await api.get<PageResult<PosProduct>>(`/products?${qs.join('&')}`);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out.filter((p) => p.type !== 'PREPARATION');
}

/* ── Admin catalog fetch (used by ProductsListView) ───────── */
//
// Drains the catalog including PREPARATION rows. Honors `includeInactive` so
// the admin can browse soft-deleted entries to reactivate them.

export async function listProductsAdmin(opts: {
  includeInactive: boolean;
}): Promise<PosProduct[]> {
  const out: PosProduct[] = [];
  let cursor: string | null = null;
  do {
    const qs: string[] = ['limit=100'];
    if (!opts.includeInactive) qs.push('active=true');
    if (cursor) qs.push(`cursor=${cursor}`);
    const page = await api.get<PageResult<PosProduct>>(`/products?${qs.join('&')}`);
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 2000) break;
  } while (cursor);
  return out;
}

/* ── Single product / CRUD ────────────────────────────────── */

export function getProduct(id: string): Promise<PosProduct> {
  return api.get<PosProduct>(`/products/${id}`);
}

export function createProduct(input: CreateProductInput): Promise<PosProduct> {
  return api.post<PosProduct>('/products', input);
}

export function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<PosProduct> {
  return api.patch<PosProduct>(`/products/${id}`, input);
}

export function deleteProduct(id: string): Promise<void> {
  return api.delete<void>(`/products/${id}`);
}

/* ── Variants (nested under product) ──────────────────────── */

export function listVariants(productId: string): Promise<ProductVariant[]> {
  return api.get<ProductVariant[]>(`/products/${productId}/variants`);
}

export function createVariant(
  productId: string,
  input: CreateVariantInput,
): Promise<ProductVariant> {
  return api.post<ProductVariant>(`/products/${productId}/variants`, input);
}

export function updateVariant(
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
): Promise<ProductVariant> {
  return api.patch<ProductVariant>(
    `/products/${productId}/variants/${variantId}`,
    input,
  );
}

export function deleteVariant(productId: string, variantId: string): Promise<void> {
  return api.delete<void>(`/products/${productId}/variants/${variantId}`);
}

/* ── Attached modifier groups ─────────────────────────────── */

export function listProductModifierGroups(
  productId: string,
): Promise<ProductModifierGroupLink[]> {
  return api.get<ProductModifierGroupLink[]>(
    `/products/${productId}/modifier-groups`,
  );
}

export function attachModifierGroup(
  productId: string,
  modifier_group_id: string,
): Promise<ProductModifierGroupLink> {
  return api.post<ProductModifierGroupLink>(
    `/products/${productId}/modifier-groups`,
    { modifier_group_id },
  );
}

export function detachModifierGroup(
  productId: string,
  groupId: string,
): Promise<void> {
  return api.delete<void>(`/products/${productId}/modifier-groups/${groupId}`);
}

/* ── Duplicate ────────────────────────────────────────────── */

export function duplicateProduct(id: string): Promise<PosProduct> {
  return api.post<PosProduct>(`/products/${id}/duplicate`, {});
}

/* ── Bulk update ──────────────────────────────────────────── */

export function bulkUpdateProducts(
  ids: string[],
  update: { active?: boolean },
): Promise<{ updated: number }> {
  return api.post<{ updated: number }>('/products/bulk-update', { ids, update });
}
