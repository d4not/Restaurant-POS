import { api } from './client';
import type {
  ModifierGroup,
  PageResult,
  Product,
  ProductCategory,
} from '../types/api';

// The menu payload for the terminal: active products only, with their
// variants and attached modifier groups already embedded so the cart flow
// doesn't need a second round-trip per product tap.
export async function getProducts(): Promise<Product[]> {
  // Pull up to the server max in one call. A café menu rarely exceeds this;
  // if it ever does we can add cursor pagination here without changing
  // consumers.
  const page = await api.get<PageResult<Product>>('/products', {
    active: 'true',
    limit: 100,
  });
  return page.items;
}

export async function getCategories(): Promise<ProductCategory[]> {
  const page = await api.get<PageResult<ProductCategory>>('/product-categories', {
    visible_in_pos: 'true',
    limit: 100,
  });
  return page.items;
}

export async function getModifierGroup(id: string): Promise<ModifierGroup> {
  return api.get<ModifierGroup>(`/modifier-groups/${id}`);
}
