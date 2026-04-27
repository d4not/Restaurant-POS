import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSupplyCategory,
  listSupplyCategories,
} from '../api/supply-categories';

export function useSupplyCategories() {
  return useQuery({
    queryKey: ['supply-categories'],
    queryFn: () => listSupplyCategories({ limit: 100 }),
    staleTime: 60_000,
  });
}

export function useCreateSupplyCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSupplyCategory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supply-categories'] }),
  });
}
