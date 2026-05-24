// Product categories — flat list used by the catalog dropdown / filters.
// The backend exposes the same paginated cursor envelope as supplies, so we
// drain it here once and let the consumer cache the result.

import { api } from './client';
import type { PageResult } from './pagination';

export interface ProductCategory {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  color: string | null;
  display_order: number;
  visible_in_pos: boolean;
  parent_id: string | null;
}

export async function listProductCategories(): Promise<ProductCategory[]> {
  const out: ProductCategory[] = [];
  let cursor: string | null = null;
  do {
    const qs: string[] = ['limit=100'];
    if (cursor) qs.push(`cursor=${cursor}`);
    const page = await api.get<PageResult<ProductCategory>>(
      `/product-categories?${qs.join('&')}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

// ── Admin CRUD ──────────────────────────────────────────────────────────────

export interface CreateCategoryInput {
  name: string;
  description?: string | null;
  color?: string | null;
  image_url?: string | null;
  display_order?: number;
  visible_in_pos?: boolean;
  parent_id?: string | null;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export function getProductCategory(id: string): Promise<ProductCategory> {
  return api.get<ProductCategory>(`/product-categories/${id}`);
}

export function createProductCategory(input: CreateCategoryInput): Promise<ProductCategory> {
  return api.post<ProductCategory>('/product-categories', input);
}

export function updateProductCategory(id: string, input: UpdateCategoryInput): Promise<ProductCategory> {
  return api.patch<ProductCategory>(`/product-categories/${id}`, input);
}

export function deleteProductCategory(id: string): Promise<void> {
  return api.delete<void>(`/product-categories/${id}`);
}
