import { useQuery } from '@tanstack/react-query';
import { listPackagings, type ListPackagingsParams } from '../api/packagings';

export function usePackagings(filters: Omit<ListPackagingsParams, 'cursor' | 'limit'>) {
  return useQuery({
    queryKey: ['packagings', filters],
    queryFn: () => listPackagings({ ...filters, limit: 100 }),
    enabled: !!(filters.supply_id || filters.supplier_id),
  });
}
