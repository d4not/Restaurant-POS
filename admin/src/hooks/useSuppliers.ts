import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createSupplier,
  deleteSupplier,
  listSuppliers,
  updateSupplier,
  type ListSuppliersParams,
} from '../api/suppliers';

const LIMIT = 50;

export function useSuppliers(filters: Omit<ListSuppliersParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['suppliers', filters],
    queryFn: ({ pageParam }) =>
      listSuppliers({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSupplier,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateSupplier>[1] }) =>
      updateSupplier(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSupplier,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}
