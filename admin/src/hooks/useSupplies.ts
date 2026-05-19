import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createSupply,
  deleteSupply,
  getSupply,
  listSupplies,
  listSupplyStocks,
  updateSupply,
  type ListSuppliesParams,
} from '../api/supplies';
import type { Paginated } from '../types/api';
import type { Supply } from '../types/inventory';

const LIMIT = 50;

type SuppliesInfData = {
  pages: Array<Paginated<Supply>>;
  pageParams: unknown[];
};

export function useSupplies(filters: Omit<ListSuppliesParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['supplies', filters],
    queryFn: ({ pageParam }) =>
      listSupplies({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useSupply(id: string | undefined) {
  return useQuery({
    queryKey: ['supply', id],
    queryFn: () => getSupply(id as string),
    enabled: !!id,
  });
}

export function useSupplyStocks(id: string | undefined) {
  return useQuery({
    queryKey: ['supply', id, 'stocks'],
    queryFn: () => listSupplyStocks(id as string, { limit: 100 }),
    enabled: !!id,
  });
}

export function useCreateSupply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSupply,
    onMutate: async (input: Parameters<typeof createSupply>[0]) => {
      await qc.cancelQueries({ queryKey: ['supplies'] });
      const tempId = `tmp_${crypto.randomUUID()}`;
      const optimistic: Supply = {
        id: tempId,
        barcode: input.barcode ?? null,
        name: input.name,
        category_id: input.category_id,
        base_unit: input.base_unit,
        content_per_unit:
          input.content_per_unit != null ? String(input.content_per_unit) : null,
        content_unit: input.content_unit ?? null,
        average_cost: '0',
        last_cost: '0',
        active: input.active ?? true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };
      const snapshot = qc.getQueriesData<SuppliesInfData>({ queryKey: ['supplies'] });
      for (const [key, data] of snapshot) {
        if (!data || data.pages.length === 0) continue;
        const [first, ...rest] = data.pages;
        qc.setQueryData<SuppliesInfData>(key, {
          ...data,
          pages: [{ ...first, items: [optimistic, ...first.items] }, ...rest],
        });
      }
      return { tempId, snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
    },
    onSuccess: (server, _vars, ctx) => {
      if (!ctx) return;
      const entries = qc.getQueriesData<SuppliesInfData>({ queryKey: ['supplies'] });
      for (const [key, data] of entries) {
        if (!data) continue;
        qc.setQueryData<SuppliesInfData>(key, {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((it) => (it.id === ctx.tempId ? server : it)),
          })),
        });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['supplies'] });
    },
  });
}

export function useUpdateSupply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateSupply>[1] }) =>
      updateSupply(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['supplies'] });
      qc.invalidateQueries({ queryKey: ['supply', data.id] });
    },
  });
}

export function useDeleteSupply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSupply,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  });
}
