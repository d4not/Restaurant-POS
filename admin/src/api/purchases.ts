import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CancelInput,
  CreatePurchaseInput,
  CreatePurchaseItemInput,
  DispatchInput,
  InTransitInput,
  PayPurchaseInput,
  Purchase,
  PurchaseItem,
  PurchaseKind,
  PurchaseStatus,
  ReceiveInput,
  ReplyPurchaseInput,
  ReturnInput,
  UpdatePurchaseInput,
  UpdatePurchaseItemInput,
  VerifyInput,
  WhatsappLink,
} from '../types/inventory';

export type {
  Purchase,
  PurchaseItem,
  PurchaseStatus,
  PurchaseKind,
} from '../types/inventory';

export interface ListPurchasesParams {
  cursor?: string;
  limit?: number;
  status?: PurchaseStatus;
  kind?: PurchaseKind;
  supplier_id?: string;
  storage_id?: string;
  runner_user_id?: string;
  from?: string;
  to?: string;
}

export function listPurchases(params: ListPurchasesParams = {}) {
  return api.get<Paginated<Purchase>>('/purchases', { ...params });
}

export function getPurchase(id: string) {
  return api.get<Purchase>(`/purchases/${id}`);
}

export function createPurchase(input: CreatePurchaseInput) {
  return api.post<Purchase>('/purchases', input);
}

export function updatePurchase(id: string, input: UpdatePurchaseInput) {
  return api.patch<Purchase>(`/purchases/${id}`, input);
}

export function deletePurchase(id: string) {
  return api.delete<void>(`/purchases/${id}`);
}

// ─── Delivery transitions ───────────────────────────────────────────────────

export function sendPurchase(id: string) {
  return api.post<Purchase>(`/purchases/${id}/send`);
}

export function replyPurchase(id: string, input: ReplyPurchaseInput) {
  return api.post<Purchase>(`/purchases/${id}/reply`, input);
}

export function payPurchase(id: string, input: PayPurchaseInput) {
  return api.post<Purchase>(`/purchases/${id}/pay`, input);
}

export function markInTransit(id: string, input: InTransitInput = {}) {
  return api.post<Purchase>(`/purchases/${id}/in-transit`, input);
}

export function receivePurchase(id: string, input: ReceiveInput) {
  return api.post<Purchase>(`/purchases/${id}/receive`, input);
}

// ─── Errand transitions ─────────────────────────────────────────────────────

export function dispatchPurchase(id: string, input: DispatchInput) {
  return api.post<Purchase>(`/purchases/${id}/dispatch`, input);
}

export function returnPurchase(id: string, input: ReturnInput) {
  return api.post<Purchase>(`/purchases/${id}/return`, input);
}

// ─── Terminal states ────────────────────────────────────────────────────────

export function verifyPurchase(id: string, input: VerifyInput = {}) {
  return api.post<Purchase>(`/purchases/${id}/verify`, input);
}

export function rejectPurchase(id: string, input: CancelInput) {
  return api.post<Purchase>(`/purchases/${id}/reject`, input);
}

export function cancelPurchase(id: string, input?: CancelInput) {
  return api.post<Purchase>(`/purchases/${id}/cancel`, input ?? {});
}

// Legacy DRAFT → VERIFIED (received = ordered). Kept so older admin flows
// that still call confirmPurchase() don't break while the wizard rolls out.
export function confirmPurchase(id: string) {
  return api.post<Purchase>(`/purchases/${id}/confirm`);
}

// ─── Items CRUD ────────────────────────────────────────────────────────────

export function addPurchaseItem(purchaseId: string, input: CreatePurchaseItemInput) {
  return api.post<PurchaseItem>(`/purchases/${purchaseId}/items`, input);
}

export function updatePurchaseItem(
  purchaseId: string,
  itemId: string,
  input: UpdatePurchaseItemInput,
) {
  return api.patch<PurchaseItem>(`/purchases/${purchaseId}/items/${itemId}`, input);
}

export function removePurchaseItem(purchaseId: string, itemId: string) {
  return api.delete<void>(`/purchases/${purchaseId}/items/${itemId}`);
}

// ─── WhatsApp link ──────────────────────────────────────────────────────────

export function getWhatsappLink(purchaseId: string) {
  return api.get<WhatsappLink>(`/purchases/${purchaseId}/whatsapp`);
}
