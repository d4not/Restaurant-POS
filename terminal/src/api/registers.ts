import { api } from './client';
import type {
  CashMovement,
  CashMovementType,
  CashRegister,
  PageResult,
} from '../types/api';

/**
 * Find the current user's open register, if any. We rely on the invariant
 * that a user can have at most one OPEN register at a time — enforced by the
 * backend's `openRegister` flow — so the first item in the list IS the one.
 */
export async function getOpenRegisterForUser(userId: string): Promise<CashRegister | null> {
  const page = await api.get<PageResult<CashRegister>>('/registers', {
    user_id: userId,
    status: 'OPEN',
    limit: 1,
  });
  return page.items[0] ?? null;
}

export function getRegister(id: string): Promise<CashRegister> {
  return api.get<CashRegister>(`/registers/${id}`);
}

export function openRegister(openingAmount: number): Promise<CashRegister> {
  return api.post<CashRegister>('/registers', { opening_amount: openingAmount });
}

export interface CloseRegisterInput {
  actual_amount: number;
  notes?: string;
}

export function closeRegister(id: string, input: CloseRegisterInput): Promise<CashRegister> {
  return api.post<CashRegister>(`/registers/${id}/close`, input);
}

export interface AddCashMovementInput {
  type: CashMovementType;
  amount: number;
  reason: string;
}

export function addCashMovement(
  registerId: string,
  input: AddCashMovementInput,
): Promise<CashMovement> {
  return api.post<CashMovement>(`/registers/${registerId}/cash-movements`, input);
}

export async function listCashMovements(registerId: string): Promise<CashMovement[]> {
  const page = await api.get<PageResult<CashMovement>>(
    `/registers/${registerId}/cash-movements`,
    { limit: 100 },
  );
  return page.items;
}
