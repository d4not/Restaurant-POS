import { api } from './client';
import type { Tax } from '../types/menu';

export interface CreateTaxInput {
  name: string;
  rate: number;
  active?: boolean;
}

export type UpdateTaxInput = Partial<CreateTaxInput>;

export interface ListTaxesParams {
  active?: boolean;
}

export function listTaxes(params: ListTaxesParams = {}) {
  const query: Record<string, string | undefined> = {};
  if (params.active !== undefined) query.active = params.active ? 'true' : 'false';
  return api.get<Tax[]>('/taxes', query);
}

export function getTax(id: string) {
  return api.get<Tax>(`/taxes/${id}`);
}

export function createTax(input: CreateTaxInput) {
  return api.post<Tax>('/taxes', input);
}

export function updateTax(id: string, input: UpdateTaxInput) {
  return api.patch<Tax>(`/taxes/${id}`, input);
}

export function deleteTax(id: string) {
  return api.delete<void>(`/taxes/${id}`);
}
