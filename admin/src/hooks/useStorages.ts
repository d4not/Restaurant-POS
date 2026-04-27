import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createStorage,
  deleteStorage,
  listStorages,
  updateStorage,
  type ListStoragesParams,
} from '../api/storages';

const LIMIT = 50;

// Two query shapes: a fast non-paginated read for selectors that just need
// the active list (current default), and an infinite-scroll variant for the
// admin page. Keeping the simple flavor as `useStorages` preserves the call
// sites that don't care about pagination.
export function useStorages() {
  return useQuery({
    queryKey: ['storages'],
    queryFn: () => listStorages({ limit: 100 }),
    staleTime: 60_000,
  });
}

export function useStoragesInfinite(
  filters: Omit<ListStoragesParams, 'cursor' | 'limit'> = {},
) {
  return useInfiniteQuery({
    queryKey: ['storages', 'infinite', filters],
    queryFn: ({ pageParam }) =>
      listStorages({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['storages'] });
}

export function useCreateStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createStorage,
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updateStorage>[1];
    }) => updateStorage(id, input),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteStorage,
    onSuccess: () => invalidateAll(qc),
  });
}
