import { api } from './client';
import type { ZoneKindValue } from './floors';

export interface ZoneRecord {
  id: string;
  name: string;
  display_order: number;
  kind: ZoneKindValue;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateZoneInput {
  name?: string;
  display_order?: number;
  active?: boolean;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
}

export interface CreateZoneInput {
  name: string;
  display_order?: number;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
}

export function patchZone(id: string, body: UpdateZoneInput): Promise<ZoneRecord> {
  return api.patch<ZoneRecord>(`/zones/${id}`, body);
}

export function createZone(body: CreateZoneInput): Promise<ZoneRecord> {
  return api.post<ZoneRecord>('/zones', body);
}

export function deleteZone(id: string): Promise<{ id: string }> {
  return api.delete<{ id: string }>(`/zones/${id}`);
}
