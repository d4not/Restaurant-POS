import { api } from './client';
import type { Paginated } from '../types/api';
import type { Storage } from '../types/inventory';

export interface ListStoragesParams {
  cursor?: string;
  limit?: number;
  active?: boolean;
  search?: string;
}

export function listStorages(params: ListStoragesParams = {}) {
  return api.get<Paginated<Storage>>('/storages', { ...params });
}
