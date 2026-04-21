import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  addOrderItem,
  addPayment,
  createOrder,
  getOrder,
  listOrders,
  removeOrderItem,
  updateOrderItem,
  type ListOrdersParams,
} from '../api/orders';

const LIMIT = 50;

export function useOrders(filters: Omit<ListOrdersParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['orders', filters],
    queryFn: ({ pageParam }) =>
      listOrders({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => getOrder(id as string),
    enabled: !!id,
  });
}

function invalidateOrders(qc: ReturnType<typeof useQueryClient>, orderId?: string) {
  qc.invalidateQueries({ queryKey: ['orders'] });
  if (orderId) qc.invalidateQueries({ queryKey: ['order', orderId] });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOrder,
    onSuccess: () => invalidateOrders(qc),
  });
}

export function useAddOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      input,
    }: {
      orderId: string;
      input: Parameters<typeof addOrderItem>[1];
    }) => addOrderItem(orderId, input),
    onSuccess: (data) => invalidateOrders(qc, data.id),
  });
}

export function useUpdateOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      itemId,
      input,
    }: {
      orderId: string;
      itemId: string;
      input: Parameters<typeof updateOrderItem>[2];
    }) => updateOrderItem(orderId, itemId, input),
    onSuccess: (data) => invalidateOrders(qc, data.id),
  });
}

export function useRemoveOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId }: { orderId: string; itemId: string }) =>
      removeOrderItem(orderId, itemId),
    onSuccess: (data) => invalidateOrders(qc, data.id),
  });
}

export function useAddPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      input,
    }: {
      orderId: string;
      input: Parameters<typeof addPayment>[1];
    }) => addPayment(orderId, input),
    onSuccess: (result, vars) => {
      invalidateOrders(qc, vars.orderId);
      // A successful payment changes register expected_amount, so refresh it.
      qc.invalidateQueries({ queryKey: ['registers'] });
      qc.invalidateQueries({ queryKey: ['register', result.order.register_id] });
    },
  });
}
