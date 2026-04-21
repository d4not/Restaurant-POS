import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getOrder, listOrders, type ListOrdersParams } from '../api/orders';

const LIMIT = 50;

export function useOrders(filters: Omit<ListOrdersParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['orders', filters],
    queryFn: ({ pageParam }) =>
      listOrders({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => getOrder(id as string),
    enabled: !!id,
  });
}
