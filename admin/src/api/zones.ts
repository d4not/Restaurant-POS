import { api } from './client';
import type { Paginated } from '../types/api';
import type { Zone, ZoneWithTables } from '../types/operations';

export interface ListZonesParams {
  cursor?: string;
  limit?: number;
  active?: boolean;
  include_tables?: boolean;
}

export function listZones(params: ListZonesParams = {}) {
  return api.get<Paginated<Zone | ZoneWithTables>>('/zones', { ...params });
}

export function getZone(id: string) {
  return api.get<ZoneWithTables>(`/zones/${id}`);
}

export interface CreateZoneInput {
  name: string;
  display_order?: number;
  active?: boolean;
}

export function createZone(input: CreateZoneInput) {
  return api.post<Zone>('/zones', input);
}

export type UpdateZoneInput = Partial<CreateZoneInput>;

export function updateZone(id: string, input: UpdateZoneInput) {
  return api.patch<Zone>(`/zones/${id}`, input);
}

export function deleteZone(id: string) {
  return api.delete<void>(`/zones/${id}`);
}
