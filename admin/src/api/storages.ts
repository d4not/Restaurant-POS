import { api } from './client';
import type { Paginated } from '../types/api';
import type { Storage } from '../types/inventory';

export interface CreateStorageInput {
  name: string;
  address?: string;
  active?: boolean;
}

export type UpdateStorageInput = Partial<CreateStorageInput>;

export interface ListStoragesParams {
  cursor?: string;
  limit?: number;
  active?: boolean;
  search?: string;
}

export function listStorages(params: ListStoragesParams = {}) {
  return api.get<Paginated<Storage>>('/storages', { ...params });
}

export function getStorage(id: string) {
  return api.get<Storage>(`/storages/${id}`);
}

export function createStorage(input: CreateStorageInput) {
  return api.post<Storage>('/storages', input);
}

export function updateStorage(id: string, input: UpdateStorageInput) {
  return api.patch<Storage>(`/storages/${id}`, input);
}

export function deleteStorage(id: string) {
  return api.delete<void>(`/storages/${id}`);
}
