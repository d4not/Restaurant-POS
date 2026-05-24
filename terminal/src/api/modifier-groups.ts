// Modifier groups — paginated list used by the AttachModifierGroupModal and
// the recipe editor's "modifier slot" picker.

import { api } from './client';
import type { PageResult } from './pagination';
import type { ModifierGroup, ModifierGroupType } from './products';

export interface ListModifierGroupsParams {
  cursor?: string;
  limit?: number;
  search?: string;
  type?: ModifierGroupType;
}

export function listModifierGroups(
  params: ListModifierGroupsParams = {},
): Promise<PageResult<ModifierGroup>> {
  const qs: string[] = [];
  if (params.cursor) qs.push(`cursor=${encodeURIComponent(params.cursor)}`);
  if (params.limit) qs.push(`limit=${params.limit}`);
  if (params.search) qs.push(`search=${encodeURIComponent(params.search)}`);
  if (params.type) qs.push(`type=${params.type}`);
  const suffix = qs.length > 0 ? `?${qs.join('&')}` : '';
  return api.get<PageResult<ModifierGroup>>(`/modifier-groups${suffix}`);
}

export async function listAllModifierGroups(): Promise<ModifierGroup[]> {
  const out: ModifierGroup[] = [];
  let cursor: string | null = null;
  do {
    const page = await listModifierGroups({ limit: 100, cursor: cursor ?? undefined });
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

export function getModifierGroup(id: string): Promise<ModifierGroup> {
  return api.get<ModifierGroup>(`/modifier-groups/${id}`);
}
