import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createModifier,
  createModifierGroup,
  deleteModifier,
  deleteModifierGroup,
  getModifierGroup,
  listGroupLinkedProducts,
  listGroupOverrides,
  listModifierGroups,
  listModifiers,
  updateModifier,
  updateModifierGroup,
  type ListModifierGroupsParams,
} from '../api/modifier-groups';

export function useModifierGroups(
  params: Omit<ListModifierGroupsParams, 'cursor' | 'limit'> = {},
) {
  return useQuery({
    queryKey: ['modifier-groups', params],
    queryFn: () => listModifierGroups({ ...params, limit: 100 }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useModifierGroup(id: string | undefined) {
  return useQuery({
    queryKey: ['modifier-group', id],
    queryFn: () => getModifierGroup(id as string),
    enabled: !!id,
  });
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createModifierGroup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updateModifierGroup>[1];
    }) => updateModifierGroup(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['modifier-group', data.id] });
    },
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteModifierGroup,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      // Deleting the group cascades to ProductModifierGroup links — any cached
      // product that referenced this group is now stale until the next mount.
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/* ── Modifiers ──────────────────────────────────────────── */

export function useModifiers(groupId: string | undefined) {
  return useQuery({
    queryKey: ['modifier-group', groupId, 'modifiers'],
    queryFn: () => listModifiers(groupId as string, { limit: 100 }),
    enabled: !!groupId,
  });
}

// Product detail queries include the group's active modifiers nested under
// modifier_groups — so any CRUD on a modifier needs to bust `['product']`
// caches or the POS / Product-detail UI may show stale options.
export function useCreateModifier(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createModifier>[1]) =>
      createModifier(groupId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-group', groupId] });
      qc.invalidateQueries({ queryKey: ['modifier-group', groupId, 'modifiers'] });
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useUpdateModifier(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      modifierId,
      input,
    }: {
      modifierId: string;
      input: Parameters<typeof updateModifier>[2];
    }) => updateModifier(groupId, modifierId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-group', groupId] });
      qc.invalidateQueries({ queryKey: ['modifier-group', groupId, 'modifiers'] });
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifier(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modifierId: string) => deleteModifier(groupId, modifierId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-group', groupId] });
      qc.invalidateQueries({ queryKey: ['modifier-group', groupId, 'modifiers'] });
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      // Cascade-deletes any modifier_product_overrides pointing at this modifier.
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

/* ── Linked products + overrides (scoped to a group) ────── */

export function useGroupLinkedProducts(groupId: string | undefined) {
  return useQuery({
    queryKey: ['modifier-group', groupId, 'products'],
    queryFn: () => listGroupLinkedProducts(groupId as string),
    enabled: !!groupId,
  });
}

export function useGroupOverrides(groupId: string | undefined) {
  return useQuery({
    queryKey: ['modifier-group', groupId, 'overrides'],
    queryFn: () => listGroupOverrides(groupId as string),
    enabled: !!groupId,
  });
}
