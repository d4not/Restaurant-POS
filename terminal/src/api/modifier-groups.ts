// Modifier groups — paginated list + full CRUD for the admin catalog tile,
// plus the AttachModifierGroupModal and recipe editor's modifier-slot picker.

import { api } from './client';
import type { PageResult } from './pagination';
import type { Modifier, ModifierGroup, ModifierGroupType } from './products';

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface ListModifierGroupsParams {
  cursor?: string;
  limit?: number;
  search?: string;
  type?: ModifierGroupType;
}

export interface CreateModifierGroupInput {
  name: string;
  type?: ModifierGroupType;
  min_selection?: number;
  max_selection?: number;
  required?: boolean;
  display_order?: number;
}

export type UpdateModifierGroupInput = Partial<CreateModifierGroupInput>;

export interface CreateModifierInput {
  name: string;
  extra_price?: number;
  supply_id?: string | null;
  supply_quantity?: number | null;
  supply_unit?: string | null;
  ratio?: number;
  is_default?: boolean;
  active?: boolean;
  display_order?: number;
}

export type UpdateModifierInput = Partial<CreateModifierInput>;

export interface LinkedProduct {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

/* ── Modifier Group CRUD ───────────────────────────────────────────────── */

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

export function createModifierGroup(input: CreateModifierGroupInput): Promise<ModifierGroup> {
  return api.post<ModifierGroup>('/modifier-groups', input);
}

export function updateModifierGroup(
  id: string,
  input: UpdateModifierGroupInput,
): Promise<ModifierGroup> {
  return api.patch<ModifierGroup>(`/modifier-groups/${id}`, input);
}

export function deleteModifierGroup(id: string): Promise<void> {
  return api.delete<void>(`/modifier-groups/${id}`);
}

/* ── Modifier CRUD (within a group) ────────────────────────────────────── */

export function listModifiers(
  groupId: string,
  params: { cursor?: string; limit?: number; active?: boolean } = {},
): Promise<PageResult<Modifier>> {
  const qs: string[] = [];
  if (params.cursor) qs.push(`cursor=${encodeURIComponent(params.cursor)}`);
  if (params.limit) qs.push(`limit=${params.limit}`);
  if (params.active !== undefined) qs.push(`active=${params.active}`);
  const suffix = qs.length > 0 ? `?${qs.join('&')}` : '';
  return api.get<PageResult<Modifier>>(`/modifier-groups/${groupId}/modifiers${suffix}`);
}

export function createModifier(
  groupId: string,
  input: CreateModifierInput,
): Promise<Modifier> {
  return api.post<Modifier>(`/modifier-groups/${groupId}/modifiers`, input);
}

export function updateModifier(
  groupId: string,
  modifierId: string,
  input: UpdateModifierInput,
): Promise<Modifier> {
  return api.patch<Modifier>(
    `/modifier-groups/${groupId}/modifiers/${modifierId}`,
    input,
  );
}

export function deleteModifier(
  groupId: string,
  modifierId: string,
): Promise<void> {
  return api.delete<void>(`/modifier-groups/${groupId}/modifiers/${modifierId}`);
}

/* ── Linked products (read-only) ───────────────────────────────────────── */

export function listGroupLinkedProducts(groupId: string): Promise<LinkedProduct[]> {
  return api.get<LinkedProduct[]>(`/modifier-groups/${groupId}/products`);
}
