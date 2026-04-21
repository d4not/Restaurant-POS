import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CashMovement,
  CashMovementType,
  CashRegister,
  CashRegisterStatus,
  CloseRegisterInput,
  CreateCashMovementInput,
  OpenRegisterInput,
} from '../types/operations';

export interface ListRegistersParams {
  cursor?: string;
  limit?: number;
  status?: CashRegisterStatus;
  user_id?: string;
  from?: string;
  to?: string;
}

export function listRegisters(params: ListRegistersParams = {}) {
  return api.get<Paginated<CashRegister>>('/registers', { ...params });
}

export function getRegister(id: string) {
  return api.get<CashRegister>(`/registers/${id}`);
}

export function openRegister(input: OpenRegisterInput) {
  return api.post<CashRegister>('/registers', input);
}

export function closeRegister(id: string, input: CloseRegisterInput) {
  return api.post<CashRegister>(`/registers/${id}/close`, input);
}

export interface ListCashMovementsParams {
  cursor?: string;
  limit?: number;
  type?: CashMovementType;
}

export function listCashMovements(registerId: string, params: ListCashMovementsParams = {}) {
  return api.get<Paginated<CashMovement>>(
    `/registers/${registerId}/cash-movements`,
    { ...params },
  );
}

export function createCashMovement(registerId: string, input: CreateCashMovementInput) {
  return api.post<CashMovement>(`/registers/${registerId}/cash-movements`, input);
}
