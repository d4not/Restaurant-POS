import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchPrinters,
  createPrinter,
  updatePrinter,
  deletePrinter,
  fetchPrintersStatus,
} from '../api/printers';

export function usePrinters() {
  return useQuery({
    queryKey: ['printers'],
    queryFn: fetchPrinters,
    staleTime: 60_000,
  });
}

export function usePrintersStatus() {
  return useQuery({
    queryKey: ['printers-status'],
    queryFn: fetchPrintersStatus,
    refetchInterval: 30_000,
  });
}

export function useCreatePrinter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPrinter,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printers'] }),
  });
}

export function useUpdatePrinter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updatePrinter>[1] }) =>
      updatePrinter(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printers'] }),
  });
}

export function useDeletePrinter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deletePrinter,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printers'] }),
  });
}
