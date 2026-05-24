import { api } from './client';
import type { PageResult } from './pagination';

export interface Storage {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// One page typically holds every active storage in a single café (≤ ~10) — we
// don't paginate in the UI for transfers; the dropdown shows every active row.
export async function listStorages(params: { active?: boolean } = {}): Promise<Storage[]> {
  const sp = new URLSearchParams();
  sp.set('limit', '100');
  if (params.active !== undefined) sp.set('active', String(params.active));
  const page = await api.get<PageResult<Storage>>(`/storages?${sp.toString()}`);
  return page.items;
}

export interface StorageStockRow {
  id: string;
  supply_id: string;
  storage_id: string;
  quantity: string;
  min_stock: string | null;
  supply: {
    id: string;
    name: string;
    base_unit: string;
    active: boolean;
  };
}

// Drains paginated stocks for a single storage — used by the admin transfer
// view to know how many of each supply the source storage actually has, so we
// can block over-transfers and show the operator the cap inline.
export async function fetchStorageStocks(
  storageId: string,
  params: { low_only?: boolean } = {},
): Promise<StorageStockRow[]> {
  const out: StorageStockRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (params.low_only) sp.set('low_only', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<StorageStockRow>>(
      `/storages/${storageId}/stocks?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 2000) break;
  } while (cursor);
  return out;
}
