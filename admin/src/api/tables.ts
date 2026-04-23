import { api } from './client';
import type { Paginated } from '../types/api';
import type { Table, TableStatus } from '../types/operations';

export interface ListTablesParams {
  cursor?: string;
  limit?: number;
  zone_id?: string;
  status?: TableStatus;
  active?: boolean;
}

export function listTables(params: ListTablesParams = {}) {
  return api.get<Paginated<Table>>('/tables', { ...params });
}

export function getTable(id: string) {
  return api.get<Table>(`/tables/${id}`);
}

export interface CreateTableInput {
  zone_id: string;
  number: number;
  capacity?: number;
  status?: TableStatus;
  active?: boolean;
}

export function createTable(input: CreateTableInput) {
  return api.post<Table>('/tables', input);
}

export interface UpdateTableInput {
  zone_id?: string;
  number?: number;
  capacity?: number;
  active?: boolean;
}

export function updateTable(id: string, input: UpdateTableInput) {
  return api.patch<Table>(`/tables/${id}`, input);
}

export function updateTableStatus(id: string, status: TableStatus) {
  return api.patch<Table>(`/tables/${id}/status`, { status });
}

export function deleteTable(id: string) {
  return api.delete<void>(`/tables/${id}`);
}
