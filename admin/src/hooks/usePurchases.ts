import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  addPurchaseItem,
  cancelPurchase,
  confirmPurchase,
  createPurchase,
  deletePurchase,
  dispatchPurchase,
  getPurchase,
  getWhatsappLink,
  listPurchases,
  markInTransit,
  payPurchase,
  receivePurchase,
  rejectPurchase,
  removePurchaseItem,
  replyPurchase,
  returnPurchase,
  sendPurchase,
  updatePurchase,
  updatePurchaseItem,
  verifyPurchase,
  type ListPurchasesParams,
} from '../api/purchases';
import type {
  CancelInput,
  DispatchInput,
  InTransitInput,
  PayPurchaseInput,
  ReceiveInput,
  ReplyPurchaseInput,
  ReturnInput,
  VerifyInput,
} from '../types/inventory';

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

export function useWhatsappLink(purchaseId: string | undefined) {
  return useQuery({
    queryKey: ['purchase', purchaseId, 'whatsapp'],
    queryFn: () => getWhatsappLink(purchaseId as string),
    enabled: !!purchaseId,
  });
}

function invalidatePurchaseCaches(qc: QueryClient, purchaseId?: string) {
  qc.invalidateQueries({ queryKey: ['purchases'] });
  if (purchaseId) {
    qc.invalidateQueries({ queryKey: ['purchase', purchaseId] });
    qc.invalidateQueries({ queryKey: ['purchase', purchaseId, 'whatsapp'] });
  }
}

// Stock-absorbing transitions ripple into supplies, movements, alerts, and
// the dashboard widget. Bundle the invalidations in one helper so every
// caller flushes the same caches consistently.
function invalidateStockSideEffects(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['supplies'] });
  qc.invalidateQueries({ queryKey: ['supply'] });
  qc.invalidateQueries({ queryKey: ['movements'] });
  qc.invalidateQueries({ queryKey: ['alerts', 'low-stock'] });
  qc.invalidateQueries({ queryKey: ['stock-availability'] });
}

// Errand transitions move cash in/out of the open shift's drawer.
function invalidateRegisterSideEffects(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['register', 'current'] });
  qc.invalidateQueries({ queryKey: ['registers'] });
  qc.invalidateQueries({ queryKey: ['cash-movements'] });
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

// ─── Delivery transitions ───────────────────────────────────────────────────

export function useSendPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendPurchase,
    onSuccess: (row) => invalidatePurchaseCaches(qc, row.id),
  });
}

export function useReplyPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReplyPurchaseInput }) =>
      replyPurchase(id, input),
    onSuccess: (row) => invalidatePurchaseCaches(qc, row.id),
  });
}

export function usePayPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PayPurchaseInput }) =>
      payPurchase(id, input),
    onSuccess: (row) => invalidatePurchaseCaches(qc, row.id),
  });
}

export function useMarkInTransit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: InTransitInput }) =>
      markInTransit(id, input ?? {}),
    onSuccess: (row) => invalidatePurchaseCaches(qc, row.id),
  });
}

export function useReceivePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReceiveInput }) =>
      receivePurchase(id, input),
    onSuccess: (row) => invalidatePurchaseCaches(qc, row.id),
  });
}

// ─── Errand transitions ─────────────────────────────────────────────────────

export function useDispatchPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DispatchInput }) =>
      dispatchPurchase(id, input),
    onSuccess: (row) => {
      invalidatePurchaseCaches(qc, row.id);
      invalidateRegisterSideEffects(qc);
    },
  });
}

export function useReturnPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReturnInput }) =>
      returnPurchase(id, input),
    onSuccess: (row) => {
      invalidatePurchaseCaches(qc, row.id);
      invalidateRegisterSideEffects(qc);
    },
  });
}

// ─── Terminal states ────────────────────────────────────────────────────────

export function useVerifyPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: VerifyInput }) =>
      verifyPurchase(id, input ?? {}),
    onSuccess: (row) => {
      invalidatePurchaseCaches(qc, row.id);
      invalidateStockSideEffects(qc);
    },
  });
}

export function useRejectPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CancelInput }) =>
      rejectPurchase(id, input),
    onSuccess: (row) => invalidatePurchaseCaches(qc, row.id),
  });
}

// Legacy: DRAFT → VERIFIED in one shot. Kept so the existing terminal
// AdminMode "Confirm" button still works while the new wizard rolls out.
export function useConfirmPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmPurchase,
    onSuccess: (row) => {
      invalidatePurchaseCaches(qc, row.id);
      invalidateStockSideEffects(qc);
    },
  });
}

export function useCancelPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: CancelInput }) =>
      cancelPurchase(id, input),
    onSuccess: (row) => invalidatePurchaseCaches(qc, row.id),
  });
}

// ─── Items (DRAFT only) ────────────────────────────────────────────────────

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
