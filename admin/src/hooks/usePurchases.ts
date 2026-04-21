import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { listPurchases, type ListPurchasesParams } from '../api/purchases';

const LIMIT = 50;

export function usePurchases(
  filters: Omit<ListPurchasesParams, 'cursor' | 'limit'> = {},
) {
  return useInfiniteQuery({
    queryKey: ['purchases', filters],
    queryFn: ({ pageParam }) =>
      listPurchases({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Single-page query — useful when a report only needs the first page (or
 *  needs a one-shot, non-paginated read for an aggregation over a window). */
export function usePurchasesSingle(
  filters: Omit<ListPurchasesParams, 'cursor'> = {},
) {
  return useQuery({
    queryKey: ['purchases', 'single', filters],
    queryFn: () => listPurchases(filters),
  });
}
