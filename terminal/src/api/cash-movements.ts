import { api } from './client';

export type CashMovementType = 'CASH_IN' | 'CASH_OUT';

export interface CreateCashMovementInput {
  type: CashMovementType;
  amount: number;
  reason: string;
}

export interface UpdateCashMovementInput {
  type?: CashMovementType;
  amount?: number;
  reason?: string;
}

export interface CashMovementResponse {
  id: string;
  register_id: string;
  type: CashMovementType;
  amount: string;
  reason: string;
  user_id: string;
  created_at: string;
}

export function createCashMovement(
  registerId: string,
  input: CreateCashMovementInput,
): Promise<CashMovementResponse> {
  return api.post<CashMovementResponse>(`/registers/${registerId}/cash-movements`, input);
}

export function updateCashMovement(
  registerId: string,
  movementId: string,
  input: UpdateCashMovementInput,
): Promise<CashMovementResponse> {
  return api.patch<CashMovementResponse>(
    `/registers/${registerId}/cash-movements/${movementId}`,
    input,
  );
}

export function deleteCashMovement(
  registerId: string,
  movementId: string,
): Promise<void> {
  return api.delete<void>(`/registers/${registerId}/cash-movements/${movementId}`);
}
