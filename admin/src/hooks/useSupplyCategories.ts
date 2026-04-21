import { useQuery } from '@tanstack/react-query';
import { listSupplyCategories } from '../api/supply-categories';

export function useSupplyCategories() {
  return useQuery({
    queryKey: ['supply-categories'],
    queryFn: () => listSupplyCategories({ limit: 100 }),
    staleTime: 60_000,
  });
}
