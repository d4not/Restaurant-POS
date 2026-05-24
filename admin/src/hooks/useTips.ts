import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  closePool,
  getCurrentPool,
  getPool,
  listPools,
  refreshPool,
  reopenPool,
  updateAllocation,
  type ListPoolsParams,
} from '../api/tips';
import type { TipPool, UpdateAllocationInput } from '../types/people';

const LIMIT = 20;

export function useTipPools(filters: Omit<ListPoolsParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['tipPools', filters],
    queryFn: ({ pageParam }) =>
      listPools({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCurrentTipPool(date?: string) {
  return useQuery({
    queryKey: ['tipPool', 'current', date ?? null],
    queryFn: () => getCurrentPool(date),
  });
}

export function useTipPool(id: string | undefined) {
  return useQuery({
    queryKey: ['tipPool', id],
    queryFn: () => getPool(id as string),
    enabled: !!id,
  });
}

function invalidateTips(qc: ReturnType<typeof useQueryClient>, poolId?: string) {
  qc.invalidateQueries({ queryKey: ['tipPools'] });
  qc.invalidateQueries({ queryKey: ['tipPool', 'current'] });
  if (poolId) qc.invalidateQueries({ queryKey: ['tipPool', poolId] });
}

export function useRefreshTipPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshPool,
    onSuccess: (pool) => invalidateTips(qc, pool.id),
  });
}

interface UpdateAllocationVars {
  poolId: string;
  userId: string;
  input: UpdateAllocationInput;
}

interface AllocCtx {
  poolSnapshot?: TipPool;
  currentSnapshot?: TipPool;
}

function patchAllocation(pool: TipPool, userId: string, input: UpdateAllocationInput): TipPool {
  return {
    ...pool,
    allocations: pool.allocations.map((alloc) =>
      alloc.user_id === userId
        ? {
            ...alloc,
            ...(input.included !== undefined ? { included: input.included } : {}),
            ...(input.override_amount !== undefined
              ? {
                  override_amount:
                    input.override_amount === null
                      ? null
                      : String(input.override_amount),
                }
              : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
          }
        : alloc,
    ),
  };
}

export function useUpdateTipAllocation() {
  const qc = useQueryClient();
  return useMutation<TipPool, Error, UpdateAllocationVars, AllocCtx>({
    mutationFn: ({ poolId, userId, input }) =>
      updateAllocation(poolId, userId, input),
    onMutate: async ({ poolId, userId, input }) => {
      await qc.cancelQueries({ queryKey: ['tipPool', poolId] });
      await qc.cancelQueries({ queryKey: ['tipPool', 'current'] });

      const poolSnapshot = qc.getQueryData<TipPool>(['tipPool', poolId]);
      if (poolSnapshot) {
        qc.setQueryData<TipPool>(
          ['tipPool', poolId],
          patchAllocation(poolSnapshot, userId, input),
        );
      }

      // The current-pool cache is keyed by date (or null) — patch every entry
      // that points at this pool so the Tips page stays in sync.
      const currentEntries = qc.getQueriesData<TipPool>({
        queryKey: ['tipPool', 'current'],
      });
      let currentSnapshot: TipPool | undefined;
      for (const [key, pool] of currentEntries) {
        if (pool?.id === poolId) {
          currentSnapshot = pool;
          qc.setQueryData<TipPool>(key, patchAllocation(pool, userId, input));
        }
      }

      return { poolSnapshot, currentSnapshot };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.poolSnapshot) {
        qc.setQueryData(['tipPool', vars.poolId], ctx.poolSnapshot);
      }
      if (ctx.currentSnapshot) {
        const entries = qc.getQueriesData<TipPool>({
          queryKey: ['tipPool', 'current'],
        });
        for (const [key, pool] of entries) {
          if (pool?.id === vars.poolId) {
            qc.setQueryData(key, ctx.currentSnapshot);
          }
        }
      }
    },
    onSettled: (_data, _err, vars) => {
      invalidateTips(qc, vars.poolId);
    },
  });
}

export function useCloseTipPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closePool,
    onSuccess: (pool) => {
      invalidateTips(qc, pool.id);
      // Closing the pool writes TIPS adjustments onto every included
      // employee's DRAFT payroll — those need to refresh immediately.
      qc.invalidateQueries({ queryKey: ['payroll'] });
      qc.invalidateQueries({ queryKey: ['payrollPeriod'] });
    },
  });
}

export function useReopenTipPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reopenPool,
    onSuccess: (pool) => {
      invalidateTips(qc, pool.id);
      qc.invalidateQueries({ queryKey: ['payroll'] });
      qc.invalidateQueries({ queryKey: ['payrollPeriod'] });
    },
  });
}
