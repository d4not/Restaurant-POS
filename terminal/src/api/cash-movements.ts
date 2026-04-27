import { api } from './client';

export type CashMovementType = 'CASH_IN' | 'CASH_OUT';

export interface CreateCashMovementInput {
  type: CashMovementType;
  amount: number;
  reason: string;
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
