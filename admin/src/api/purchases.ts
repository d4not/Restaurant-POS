import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CreatePurchaseInput,
  CreatePurchaseItemInput,
  Purchase,
  PurchaseItem,
  PurchaseStatus,
  UpdatePurchaseInput,
  UpdatePurchaseItemInput,
} from '../types/inventory';

export type { Purchase, PurchaseItem, PurchaseStatus } from '../types/inventory';

export interface ListPurchasesParams {
  cursor?: string;
  limit?: number;
  status?: PurchaseStatus;
  supplier_id?: string;
  storage_id?: string;
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

export function confirmPurchase(id: string) {
  return api.post<Purchase>(`/purchases/${id}/confirm`);
}

export function cancelPurchase(id: string) {
  return api.post<Purchase>(`/purchases/${id}/cancel`);
}

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
