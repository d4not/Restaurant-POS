import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createZone,
  deleteZone,
  getZone,
  listZones,
  updateZone,
  type ListZonesParams,
} from '../api/zones';

export function useZones(params: ListZonesParams = {}) {
  return useQuery({
    queryKey: ['zones', params],
    queryFn: () => listZones({ limit: 100, ...params }),
    staleTime: 30_000,
  });
}

export function useZone(id: string | undefined) {
  return useQuery({
    queryKey: ['zone', id],
    queryFn: () => getZone(id as string),
    enabled: !!id,
  });
}

function invalidateZonesAndTables(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['zones'] });
  qc.invalidateQueries({ queryKey: ['zone'] });
  // Tables embed their zone — refetch them too.
  qc.invalidateQueries({ queryKey: ['tables'] });
  qc.invalidateQueries({ queryKey: ['table'] });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createZone,
    onSuccess: () => invalidateZonesAndTables(qc),
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateZone>[1] }) =>
      updateZone(id, input),
    onSuccess: () => invalidateZonesAndTables(qc),
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteZone,
    onSuccess: () => invalidateZonesAndTables(qc),
  });
}
