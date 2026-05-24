import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createModification,
  deleteModification,
  listModifications,
  updateModification,
} from '../api/product-modifications';
import type {
  CreateModificationInput,
  ProductModification,
  UpdateModificationInput,
} from '../api/products';

export function useProductModifications(
  productId: string | undefined,
  opts: { enabled?: boolean } = {},
) {
  return useQuery<ProductModification[]>({
    queryKey: ['admin', 'productModifications', productId],
    queryFn: () => listModifications(productId as string),
    enabled: !!productId && opts.enabled !== false,
    staleTime: 30_000,
  });
}

export function useCreateModification(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateModificationInput) =>
      createModification(productId, input),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['admin', 'productModifications', productId],
      });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}

export function useUpdateModification(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      modificationId,
      input,
    }: {
      modificationId: string;
      input: UpdateModificationInput;
    }) => updateModification(productId, modificationId, input),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['admin', 'productModifications', productId],
      });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}

export function useDeleteModification(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modificationId: string) =>
      deleteModification(productId, modificationId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['admin', 'productModifications', productId],
      });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}
