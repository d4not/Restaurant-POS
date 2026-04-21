import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createSupply,
  deleteSupply,
  getSupply,
  listSupplies,
  listSupplyStocks,
  updateSupply,
  type ListSuppliesParams,
} from '../api/supplies';

const LIMIT = 50;

export function useSupplies(filters: Omit<ListSuppliesParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['supplies', filters],
    queryFn: ({ pageParam }) =>
      listSupplies({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useSupply(id: string | undefined) {
  return useQuery({
    queryKey: ['supply', id],
    queryFn: () => getSupply(id as string),
    enabled: !!id,
  });
}

export function useSupplyStocks(id: string | undefined) {
  return useQuery({
    queryKey: ['supply', id, 'stocks'],
    queryFn: () => listSupplyStocks(id as string, { limit: 100 }),
    enabled: !!id,
  });
}

export function useCreateSupply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSupply,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  });
}

export function useUpdateSupply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateSupply>[1] }) =>
      updateSupply(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['supplies'] });
      qc.invalidateQueries({ queryKey: ['supply', data.id] });
    },
  });
}

export function useDeleteSupply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSupply,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  });
}
