import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPackaging,
  deletePackaging,
  listPackagings,
  updatePackaging,
  type ListPackagingsParams,
} from '../api/packagings';

export function usePackagings(filters: Omit<ListPackagingsParams, 'cursor' | 'limit'>) {
  return useQuery({
    queryKey: ['packagings', filters],
    queryFn: () => listPackagings({ ...filters, limit: 100 }),
    enabled: !!(filters.supply_id || filters.supplier_id),
  });
}

export function useCreatePackaging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPackaging,
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['packagings'] });
      qc.invalidateQueries({ queryKey: ['supply', row.supply_id] });
    },
  });
}

export function useUpdatePackaging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updatePackaging>[1] }) =>
      updatePackaging(id, input),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['packagings'] });
      qc.invalidateQueries({ queryKey: ['supply', row.supply_id] });
    },
  });
}

export function useDeletePackaging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePackaging(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packagings'] });
    },
  });
}
