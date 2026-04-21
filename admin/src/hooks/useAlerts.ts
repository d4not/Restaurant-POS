import { useQuery } from '@tanstack/react-query';
import { listLowStock, type LowStockParams } from '../api/alerts';

export function useLowStock(params: LowStockParams = {}) {
  return useQuery({
    queryKey: ['alerts', 'low-stock', params],
    queryFn: () => listLowStock(params),
  });
}
