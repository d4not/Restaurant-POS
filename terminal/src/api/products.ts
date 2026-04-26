import { api } from './client';
import type { PageResult } from './pagination';

export type ProductType = 'PRODUCT' | 'DISH' | 'PREPARATION';
export type ModifierGroupType = 'SWAP' | 'ADD';

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  sell_price: string;
  barcode: string | null;
  display_order: number;
  active: boolean;
}

export interface Modifier {
  id: string;
  group_id: string;
  name: string;
  extra_price: string;
  active: boolean;
  display_order: number;
  is_default: boolean;
  ratio: string;
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
}

export interface ProductModifierGroupLink {
  id: string;
  product_id: string;
  modifier_group_id: string;
  modifier_group: ModifierGroup;
}

export interface PosProduct {
  id: string;
  name: string;
  type: ProductType;
  category_id: string | null;
  station_id: string | null;
  sell_price: string | null;
  image_url: string | null;
  icon_color: string | null;
  display_order: number;
  active: boolean;
  allow_discount: boolean;
  sold_by_weight: boolean;
  barcode: string | null;
  tax_id: string | null;
  variants: ProductVariant[];
  modifier_groups: ProductModifierGroupLink[];
}

// Pull every active, in-POS product. The backend caps page size at 100; for
// most cafés the catalogue fits in a single page, but we paginate anyway so
// the UI doesn't silently truncate at 100 items.
export async function fetchAllProducts(): Promise<PosProduct[]> {
  const out: PosProduct[] = [];
  let cursor: string | null = null;
  do {
    const qs: string[] = ['limit=100', 'active=true'];
    if (cursor) qs.push(`cursor=${cursor}`);
    const page: PageResult<PosProduct> = await api.get<PageResult<PosProduct>>(
      `/products?${qs.join('&')}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out.filter((p) => p.type !== 'PREPARATION');
}
