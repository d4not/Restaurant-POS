import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createTax,
  deleteTax,
  listTaxes,
  updateTax,
  type CreateTaxInput,
  type ListTaxesParams,
  type UpdateTaxInput,
} from '../api/taxes';

export function useTaxes(params: ListTaxesParams = {}) {
  return useQuery({
    queryKey: ['taxes', params],
    queryFn: () => listTaxes(params),
    staleTime: 60_000,
  });
}

export function useCreateTax() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaxInput) => createTax(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxes'] }),
  });
}

export function useUpdateTax() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaxInput }) =>
      updateTax(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxes'] });
      // Product detail embeds the Tax row (name + rate). Refresh so the UI
      // reflects the new rate on subsequent line-add operations — already-paid
      // orders stay frozen via the per-item tax snapshot on the backend.
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteTax() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTax(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxes'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}
