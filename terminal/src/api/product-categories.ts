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
