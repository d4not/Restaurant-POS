import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CreateCategoryInput,
  ProductCategory,
  UpdateCategoryInput,
} from '../types/menu';

export interface ListCategoriesParams {
  cursor?: string;
  limit?: number;
  /** 'null' string filters for top-level categories; a UUID filters for children. */
  parent_id?: string | 'null';
  visible_in_pos?: boolean;
  search?: string;
}

export function listProductCategories(params: ListCategoriesParams = {}) {
  const query: Record<string, string | number | undefined> = {
    cursor: params.cursor,
    limit: params.limit,
    parent_id: params.parent_id,
    search: params.search,
  };
  if (params.visible_in_pos !== undefined) {
    query.visible_in_pos = params.visible_in_pos ? 'true' : 'false';
  }
  return api.get<Paginated<ProductCategory>>('/product-categories', query);
}

export function getProductCategory(id: string) {
  return api.get<ProductCategory>(`/product-categories/${id}`);
}

export function createProductCategory(input: CreateCategoryInput) {
  return api.post<ProductCategory>('/product-categories', input);
}

export function updateProductCategory(id: string, input: UpdateCategoryInput) {
  return api.patch<ProductCategory>(`/product-categories/${id}`, input);
}

export function deleteProductCategory(id: string) {
  return api.delete<void>(`/product-categories/${id}`);
}
