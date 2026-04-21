import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CreateModifierGroupInput,
  CreateModifierInput,
  Modifier,
  ModifierGroup,
  UpdateModifierGroupInput,
  UpdateModifierInput,
} from '../types/menu';

export interface ListModifierGroupsParams {
  cursor?: string;
  limit?: number;
  search?: string;
}

export function listModifierGroups(params: ListModifierGroupsParams = {}) {
  return api.get<Paginated<ModifierGroup>>('/modifier-groups', { ...params });
}

export function getModifierGroup(id: string) {
  return api.get<ModifierGroup>(`/modifier-groups/${id}`);
}

export function createModifierGroup(input: CreateModifierGroupInput) {
  return api.post<ModifierGroup>('/modifier-groups', input);
}

export function updateModifierGroup(id: string, input: UpdateModifierGroupInput) {
  return api.patch<ModifierGroup>(`/modifier-groups/${id}`, input);
}

export function deleteModifierGroup(id: string) {
  return api.delete<void>(`/modifier-groups/${id}`);
}

/* ── Modifiers (nested) ─────────────────────────────────── */

export interface ListModifiersParams {
  cursor?: string;
  limit?: number;
  active?: boolean;
}

export function listModifiers(groupId: string, params: ListModifiersParams = {}) {
  const query: Record<string, string | number | undefined> = {
    cursor: params.cursor,
    limit: params.limit,
  };
  if (params.active !== undefined) query.active = params.active ? 'true' : 'false';
  return api.get<Paginated<Modifier>>(`/modifier-groups/${groupId}/modifiers`, query);
}

export function createModifier(groupId: string, input: CreateModifierInput) {
  return api.post<Modifier>(`/modifier-groups/${groupId}/modifiers`, input);
}

export function updateModifier(
  groupId: string,
  modifierId: string,
  input: UpdateModifierInput,
) {
  return api.patch<Modifier>(
    `/modifier-groups/${groupId}/modifiers/${modifierId}`,
    input,
  );
}

export function deleteModifier(groupId: string, modifierId: string) {
  return api.delete<void>(`/modifier-groups/${groupId}/modifiers/${modifierId}`);
}
