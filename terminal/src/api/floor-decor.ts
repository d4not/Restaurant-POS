import { api } from './client';
import type { DecorTypeValue } from './floors';

export interface FloorDecorRecord {
  id: string;
  zone_id: string;
  type: DecorTypeValue;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  label: string | null;
  rotation: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateFloorDecorInput {
  zone_id: string;
  type: DecorTypeValue;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  label?: string | null;
  rotation?: number;
}

export interface UpdateFloorDecorInput {
  zone_id?: string;
  type?: DecorTypeValue;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  label?: string | null;
  rotation?: number;
  active?: boolean;
}

export function createDecor(body: CreateFloorDecorInput): Promise<FloorDecorRecord> {
  return api.post<FloorDecorRecord>('/floor-decor', body);
}

export function patchDecor(
  id: string,
  body: UpdateFloorDecorInput,
): Promise<FloorDecorRecord> {
  return api.patch<FloorDecorRecord>(`/floor-decor/${id}`, body);
}

export function deleteDecor(id: string): Promise<{ id: string }> {
  return api.delete<{ id: string }>(`/floor-decor/${id}`);
}
