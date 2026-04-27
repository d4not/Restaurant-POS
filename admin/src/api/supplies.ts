import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  ContentUnit,
  CreateSupplyInput,
  StorageStock,
  Supply,
  UpdateSupplyInput,
} from '../types/inventory';

export interface BarcodeLookupExisting {
  id: string;
  name: string;
  barcode: string | null;
  category_id: string;
  active: boolean;
}

export interface BarcodeLookupResult {
  existing: BarcodeLookupExisting | null;
  lookup: {
    name: string;
    brand: string | null;
    image_url: string | null;
    content_per_unit: number | null;
    content_unit: ContentUnit | null;
    categories: string[];
    source: 'openfoodfacts';
  } | null;
}

export interface ListSuppliesParams {
  cursor?: string;
  limit?: number;
  category_id?: string;
  active?: boolean;
  search?: string;
  include_deleted?: boolean;
}

export function listSupplies(params: ListSuppliesParams = {}) {
  return api.get<Paginated<Supply>>('/supplies', { ...params });
}

export function getSupply(id: string) {
  return api.get<Supply>(`/supplies/${id}`);
}

export function createSupply(input: CreateSupplyInput) {
  return api.post<Supply>('/supplies', input);
}

export function updateSupply(id: string, input: UpdateSupplyInput) {
  return api.patch<Supply>(`/supplies/${id}`, input);
}

export function deleteSupply(id: string) {
  return api.delete<void>(`/supplies/${id}`);
}

export function listSupplyStocks(
  supplyId: string,
  params: { cursor?: string; limit?: number } = {},
) {
  return api.get<Paginated<StorageStock>>(`/supplies/${supplyId}/stocks`, { ...params });
}

export function lookupBarcode(barcode: string) {
  return api.get<BarcodeLookupResult>(
    `/supplies/barcode-lookup/${encodeURIComponent(barcode)}`,
  );
}
