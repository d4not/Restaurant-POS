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
