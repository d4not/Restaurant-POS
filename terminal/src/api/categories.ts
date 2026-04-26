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
  created_at: string;
  updated_at: string;
}

export async function fetchAllCategories(): Promise<ProductCategory[]> {
  const out: ProductCategory[] = [];
  let cursor: string | null = null;
  do {
    const qs: string[] = ['limit=100', 'visible_in_pos=true'];
    if (cursor) qs.push(`cursor=${cursor}`);
    const page: PageResult<ProductCategory> = await api.get<PageResult<ProductCategory>>(
      `/product-categories?${qs.join('&')}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}
