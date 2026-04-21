import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createModification,
  deleteModification,
  listModifications,
  updateModification,
} from '../api/product-modifications';

export function useModifications(productId: string | undefined) {
  return useQuery({
    queryKey: ['product', productId, 'modifications'],
    queryFn: () => listModifications(productId as string),
    enabled: !!productId,
  });
}

export function useCreateModification(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createModification>[1]) =>
      createModification(productId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId, 'modifications'] });
      qc.invalidateQueries({ queryKey: ['product', productId] });
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
      input: Parameters<typeof updateModification>[2];
    }) => updateModification(productId, modificationId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId, 'modifications'] });
    },
  });
}

export function useDeleteModification(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modificationId: string) =>
      deleteModification(productId, modificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId, 'modifications'] });
    },
  });
}
