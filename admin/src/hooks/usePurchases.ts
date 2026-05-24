import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  addPurchaseItem,
  cancelPurchase,
  confirmPurchase,
  createPurchase,
  deletePurchase,
  getPurchase,
  listPurchases,
  removePurchaseItem,
  updatePurchase,
  updatePurchaseItem,
  type ListPurchasesParams,
} from '../api/purchases';

const LIMIT = 30;

export function usePurchases(
  filters: Omit<ListPurchasesParams, 'cursor' | 'limit'> = {},
) {
  return useInfiniteQuery({
    queryKey: ['purchases', filters],
    queryFn: ({ pageParam }) =>
      listPurchases({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Single-page query — useful when a report only needs the first page (or
 *  needs a one-shot, non-paginated read for an aggregation over a window). */
export function usePurchasesSingle(
  filters: Omit<ListPurchasesParams, 'cursor'> = {},
) {
  return useQuery({
    queryKey: ['purchases', 'single', filters],
    queryFn: () => listPurchases(filters),
  });
}

export function usePurchase(id: string | undefined) {
  return useQuery({
    queryKey: ['purchase', id],
    queryFn: () => getPurchase(id as string),
    enabled: !!id,
  });
}

function invalidatePurchaseCaches(
  qc: ReturnType<typeof useQueryClient>,
  purchaseId?: string,
) {
  qc.invalidateQueries({ queryKey: ['purchases'] });
  if (purchaseId) qc.invalidateQueries({ queryKey: ['purchase', purchaseId] });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPurchase,
    onSuccess: () => invalidatePurchaseCaches(qc),
  });
}

export function useUpdatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updatePurchase>[1] }) =>
      updatePurchase(id, input),
    onSuccess: (_data, vars) => invalidatePurchaseCaches(qc, vars.id),
  });
}

export function useDeletePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deletePurchase,
    onSuccess: () => invalidatePurchaseCaches(qc),
  });
}

// Confirming a purchase mutates stock, WAC, and creates stock movements, so
// we also invalidate the downstream caches that admin pages read from.
export function useConfirmPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmPurchase,
    onSuccess: (row) => {
      invalidatePurchaseCaches(qc, row.id);
      qc.invalidateQueries({ queryKey: ['supplies'] });
      qc.invalidateQueries({ queryKey: ['supply'] });
      qc.invalidateQueries({ queryKey: ['movements'] });
      // Purchase confirm receives stock → topbar bell + dashboard widget
      // should drop the alert immediately.
      qc.invalidateQueries({ queryKey: ['alerts', 'low-stock'] });
    },
  });
}

export function useCancelPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: cancelPurchase,
    onSuccess: (row) => invalidatePurchaseCaches(qc, row.id),
  });
}

export function useAddPurchaseItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      purchaseId,
      input,
    }: {
      purchaseId: string;
      input: Parameters<typeof addPurchaseItem>[1];
    }) => addPurchaseItem(purchaseId, input),
    onSuccess: (_data, vars) => invalidatePurchaseCaches(qc, vars.purchaseId),
  });
}

export function useUpdatePurchaseItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      purchaseId,
      itemId,
      input,
    }: {
      purchaseId: string;
      itemId: string;
      input: Parameters<typeof updatePurchaseItem>[2];
    }) => updatePurchaseItem(purchaseId, itemId, input),
    onSuccess: (_data, vars) => invalidatePurchaseCaches(qc, vars.purchaseId),
  });
}

export function useRemovePurchaseItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ purchaseId, itemId }: { purchaseId: string; itemId: string }) =>
      removePurchaseItem(purchaseId, itemId),
    onSuccess: (_data, vars) => invalidatePurchaseCaches(qc, vars.purchaseId),
  });
}
