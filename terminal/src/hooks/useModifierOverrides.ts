import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createOverride,
  deleteOverride,
  listOverrides,
  updateOverride,
} from '../api/modifier-overrides';
import type {
  CreateOverrideInput,
  ModifierProductOverride,
  UpdateOverrideInput,
} from '../api/products';

export function useModifierOverrides(productId: string | undefined) {
  return useQuery<ModifierProductOverride[]>({
    queryKey: ['admin', 'modifierOverrides', productId],
    queryFn: () => listOverrides(productId as string),
    enabled: !!productId,
    staleTime: 30_000,
  });
}

export function useCreateOverride(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOverrideInput) => createOverride(productId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modifierOverrides', productId] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
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
      qc.invalidateQueries({ queryKey: ['admin', 'modifierOverrides', productId] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}

export function useDeleteOverride(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modifierId: string) => deleteOverride(productId, modifierId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modifierOverrides', productId] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}
