import { useInfiniteQuery } from '@tanstack/react-query';
import { listMovements, type ListMovementsParams } from '../api/movements';

const LIMIT = 50;

export function useMovements(filters: Omit<ListMovementsParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['movements', filters],
    queryFn: ({ pageParam }) =>
      listMovements({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
