import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAllModifierGroups,
  listModifierGroups,
  getModifierGroup,
  createModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
  createModifier,
  updateModifier,
  deleteModifier,
  listGroupLinkedProducts,
  type CreateModifierGroupInput,
  type UpdateModifierGroupInput,
  type CreateModifierInput,
  type UpdateModifierInput,
  type ListModifierGroupsParams,
} from '../api/modifier-groups';

const STALE = 30_000;

export function useAllModifierGroups() {
  return useQuery({
    queryKey: ['admin', 'modifierGroups', 'all'],
    queryFn: listAllModifierGroups,
    staleTime: 60_000,
  });
}

export function useModifierGroups(params?: ListModifierGroupsParams) {
  return useQuery({
    queryKey: ['admin', 'modifierGroups', params],
    queryFn: () => listModifierGroups(params),
    staleTime: STALE,
  });
}

export function useModifierGroup(id: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['admin', 'modifierGroup', id],
    queryFn: () => getModifierGroup(id as string),
    enabled: !!id && opts.enabled !== false,
    staleTime: STALE,
  });
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateModifierGroupInput) => createModifierGroup(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroups'] });
    },
  });
}

export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateModifierGroupInput }) =>
      updateModifierGroup(id, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroups'] });
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroup', vars.id] });
    },
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteModifierGroup(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroups'] });
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });
}

export function useGroupLinkedProducts(groupId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'modifierGroup', groupId, 'linkedProducts'],
    queryFn: () => listGroupLinkedProducts(groupId as string),
    enabled: !!groupId,
    staleTime: STALE,
  });
}

export function useCreateModifier(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateModifierInput) => createModifier(groupId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroup', groupId] });
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroups'] });
    },
  });
}

export function useUpdateModifier(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modifierId, input }: { modifierId: string; input: UpdateModifierInput }) =>
      updateModifier(groupId, modifierId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroup', groupId] });
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroups'] });
    },
  });
}

export function useDeleteModifier(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modifierId: string) => deleteModifier(groupId, modifierId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroup', groupId] });
      qc.invalidateQueries({ queryKey: ['admin', 'modifierGroups'] });
    },
  });
}

export type { ListModifierGroupsParams };
