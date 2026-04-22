import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createOverride,
  deleteOverride,
  listOverrides,
  updateOverride,
} from '../api/modifier-overrides';
import type {
  CreateOverrideInput,
  UpdateOverrideInput,
} from '../types/menu';

export function useModifierOverrides(productId: string | undefined) {
  return useQuery({
    queryKey: ['product', productId, 'modifier-overrides'],
    queryFn: () => listOverrides(productId as string),
    enabled: !!productId,
  });
}

export function useCreateOverride(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOverrideInput) => createOverride(productId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId, 'modifier-overrides'] });
      qc.invalidateQueries({ queryKey: ['modifier-group'] });
    },
  });
}

export function useUpdateOverride(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      modifierId,
      input,
    }: {
      modifierId: string;
      input: UpdateOverrideInput;
    }) => updateOverride(productId, modifierId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId, 'modifier-overrides'] });
      qc.invalidateQueries({ queryKey: ['modifier-group'] });
    },
  });
}

export function useDeleteOverride(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modifierId: string) => deleteOverride(productId, modifierId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId, 'modifier-overrides'] });
      qc.invalidateQueries({ queryKey: ['modifier-group'] });
    },
  });
}
