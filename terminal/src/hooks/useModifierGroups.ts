// Wraps the modifier-groups list. Used by AttachModifierGroupModal and the
// recipe editor's SWAP-slot picker.

import { useQuery } from '@tanstack/react-query';
import {
  listAllModifierGroups,
  getModifierGroup,
  type ListModifierGroupsParams,
} from '../api/modifier-groups';

export function useAllModifierGroups() {
  return useQuery({
    queryKey: ['admin', 'modifierGroups', 'all'],
    queryFn: listAllModifierGroups,
    staleTime: 60_000,
  });
}

export function useModifierGroup(id: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['admin', 'modifierGroup', id],
    queryFn: () => getModifierGroup(id as string),
    enabled: !!id && opts.enabled !== false,
    staleTime: 60_000,
  });
}

// Re-exported for callers that want to set their own filter axis.
export type { ListModifierGroupsParams };
