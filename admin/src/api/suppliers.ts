import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CreateSupplierInput,
  Supplier,
  UpdateSupplierInput,
} from '../types/inventory';

export interface ListSuppliersParams {
  cursor?: string;
  limit?: number;
  active?: boolean;
  search?: string;
}

export function listSuppliers(params: ListSuppliersParams = {}) {
  return api.get<Paginated<Supplier>>('/suppliers', { ...params });
}

export function getSupplier(id: string) {
  return api.get<Supplier>(`/suppliers/${id}`);
}

export function createSupplier(input: CreateSupplierInput) {
  return api.post<Supplier>('/suppliers', input);
}

export function updateSupplier(id: string, input: UpdateSupplierInput) {
  return api.patch<Supplier>(`/suppliers/${id}`, input);
}

export function deleteSupplier(id: string) {
  return api.delete<void>(`/suppliers/${id}`);
}
