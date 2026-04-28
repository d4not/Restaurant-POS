import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getDailyReport,
  listDailyReports,
  type ListDailyReportParams,
} from '../api/daily-reports';

const LIMIT = 50;

export function useDailyReports(
  filters: Omit<ListDailyReportParams, 'cursor' | 'limit'> = {},
) {
  return useInfiniteQuery({
    queryKey: ['daily-reports', filters],
    queryFn: ({ pageParam }) =>
      listDailyReports({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useDailyReport(id: string | undefined) {
  return useQuery({
    queryKey: ['daily-report', id],
    queryFn: () => getDailyReport(id as string),
    enabled: !!id,
  });
}
