import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  closeRegister,
  createCashMovement,
  getRegister,
  listCashMovements,
  listRegisters,
  openRegister,
  type ListCashMovementsParams,
  type ListRegistersParams,
} from '../api/registers';

const LIMIT = 50;

export function useRegisters(filters: Omit<ListRegistersParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['registers', filters],
    queryFn: ({ pageParam }) =>
      listRegisters({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Current OPEN register for the signed-in user, or null. */
export function useCurrentUserRegister(userId: string | undefined) {
  return useQuery({
    queryKey: ['registers', 'current', userId],
    queryFn: async () => {
      if (!userId) return null;
      const page = await listRegisters({ status: 'OPEN', user_id: userId, limit: 1 });
      return page.items[0] ?? null;
    },
    enabled: !!userId,
  });
}

export function useRegister(id: string | undefined) {
  return useQuery({
    queryKey: ['register', id],
    queryFn: () => getRegister(id as string),
    enabled: !!id,
  });
}

export function useRegisterCashMovements(
  id: string | undefined,
  filters: Omit<ListCashMovementsParams, 'cursor' | 'limit'> = {},
) {
  return useInfiniteQuery({
    queryKey: ['register', id, 'cash-movements', filters],
    queryFn: ({ pageParam }) =>
      listCashMovements(id as string, { ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id,
  });
}

function invalidateRegisterQueries(
  qc: ReturnType<typeof useQueryClient>,
  registerId?: string,
) {
  qc.invalidateQueries({ queryKey: ['registers'] });
  if (registerId) {
    qc.invalidateQueries({ queryKey: ['register', registerId] });
  }
}

export function useOpenRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: openRegister,
    onSuccess: () => invalidateRegisterQueries(qc),
  });
}

export function useCloseRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof closeRegister>[1] }) =>
      closeRegister(id, input),
    onSuccess: (data) => invalidateRegisterQueries(qc, data.id),
  });
}

export function useCreateCashMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      registerId,
      input,
    }: {
      registerId: string;
      input: Parameters<typeof createCashMovement>[1];
    }) => createCashMovement(registerId, input),
    onSuccess: (_data, vars) => invalidateRegisterQueries(qc, vars.registerId),
  });
}
