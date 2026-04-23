import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createTable,
  deleteTable,
  getTable,
  listTables,
  updateTable,
  updateTableStatus,
  type ListTablesParams,
} from '../api/tables';
import type { TableStatus } from '../types/operations';

export function useTables(params: ListTablesParams = {}) {
  return useQuery({
    queryKey: ['tables', params],
    queryFn: () => listTables({ limit: 200, ...params }),
    staleTime: 15_000,
  });
}

export function useTable(id: string | undefined) {
  return useQuery({
    queryKey: ['table', id],
    queryFn: () => getTable(id as string),
    enabled: !!id,
  });
}

function invalidateTables(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['tables'] });
  qc.invalidateQueries({ queryKey: ['table'] });
  // Zones embed table counts when include_tables=true — refresh them too.
  qc.invalidateQueries({ queryKey: ['zones'] });
  qc.invalidateQueries({ queryKey: ['zone'] });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTable,
    onSuccess: () => invalidateTables(qc),
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateTable>[1] }) =>
      updateTable(id, input),
    onSuccess: () => invalidateTables(qc),
  });
}

export function useUpdateTableStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TableStatus }) =>
      updateTableStatus(id, status),
    onSuccess: () => {
      invalidateTables(qc);
      // Status changes affect orders' embedded table.status snapshot.
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteTable,
    onSuccess: () => invalidateTables(qc),
  });
}
