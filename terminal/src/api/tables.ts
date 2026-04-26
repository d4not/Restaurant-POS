import { api } from './client';
import type { TableShapeValue, TableStatusValue } from './floors';

export interface TableRecord {
  id: string;
  zone_id: string;
  number: number;
  capacity: number;
  status: TableStatusValue;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  shape: TableShapeValue;
  label: string | null;
  rotation: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateTableLayout {
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  shape?: TableShapeValue;
  label?: string | null;
  rotation?: number;
  capacity?: number;
  number?: number;
  zone_id?: string;
  active?: boolean;
}

export interface CreateTableInput {
  zone_id: string;
  number: number;
  capacity?: number;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  shape?: TableShapeValue;
  label?: string | null;
}

export function patchTable(id: string, body: UpdateTableLayout): Promise<TableRecord> {
  return api.patch<TableRecord>(`/tables/${id}`, body);
}

export function createTable(body: CreateTableInput): Promise<TableRecord> {
  return api.post<TableRecord>('/tables', body);
}

export function deleteTable(id: string): Promise<{ id: string }> {
  return api.delete<{ id: string }>(`/tables/${id}`);
}
