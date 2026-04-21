import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CreateProductInput,
  CreateVariantInput,
  ModifierGroupLink,
  Product,
  ProductType,
  ProductVariant,
  UpdateProductInput,
  UpdateVariantInput,
} from '../types/menu';

export interface ListProductsParams {
  cursor?: string;
  limit?: number;
  type?: ProductType;
  category_id?: string;
  active?: boolean;
  include_deleted?: boolean;
  search?: string;
}

export function listProducts(params: ListProductsParams = {}) {
  // Zod on the backend expects 'true' | 'false' strings for booleans.
  const query: Record<string, string | number | undefined> = {
    cursor: params.cursor,
    limit: params.limit,
    type: params.type,
    category_id: params.category_id,
    search: params.search,
  };
  if (params.active !== undefined) query.active = params.active ? 'true' : 'false';
  if (params.include_deleted !== undefined)
    query.include_deleted = params.include_deleted ? 'true' : 'false';
  return api.get<Paginated<Product>>('/products', query);
}

export function getProduct(id: string) {
  return api.get<Product>(`/products/${id}`);
}

export function createProduct(input: CreateProductInput) {
  return api.post<Product>('/products', input);
}

export function updateProduct(id: string, input: UpdateProductInput) {
  return api.patch<Product>(`/products/${id}`, input);
}

export function deleteProduct(id: string) {
  return api.delete<void>(`/products/${id}`);
}

/* ── Variants ───────────────────────────────────────────── */

export function listVariants(productId: string) {
  return api.get<ProductVariant[]>(`/products/${productId}/variants`);
}

export function createVariant(productId: string, input: CreateVariantInput) {
  return api.post<ProductVariant>(`/products/${productId}/variants`, input);
}

export function updateVariant(
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
) {
  return api.patch<ProductVariant>(
    `/products/${productId}/variants/${variantId}`,
    input,
  );
}

export function deleteVariant(productId: string, variantId: string) {
  return api.delete<void>(`/products/${productId}/variants/${variantId}`);
}

/* ── Attached modifier groups ───────────────────────────── */

export function listProductModifierGroups(productId: string) {
  return api.get<ModifierGroupLink[]>(`/products/${productId}/modifier-groups`);
}

export function attachModifierGroup(productId: string, modifier_group_id: string) {
  return api.post<ModifierGroupLink>(`/products/${productId}/modifier-groups`, {
    modifier_group_id,
  });
}

export function detachModifierGroup(productId: string, groupId: string) {
  return api.delete<void>(
    `/products/${productId}/modifier-groups/${groupId}`,
  );
}
