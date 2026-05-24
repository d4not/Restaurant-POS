import { api } from './client';
import type { PageResult } from './pagination';

export type WriteOffReason = 'EXPIRED' | 'DAMAGED' | 'SPILLED' | 'THEFT' | 'OTHER';
export const WRITE_OFF_REASONS: WriteOffReason[] = [
  'EXPIRED',
  'DAMAGED',
  'SPILLED',
  'THEFT',
  'OTHER',
];

export interface CreateWriteOffInput {
  storage_id: string;
  supply_id: string;
  quantity: number;
  reason: WriteOffReason;
  notes?: string;
  date: string;
}

export interface WriteOff {
  id: string;
  storage_id: string;
  supply_id: string;
  quantity: string;
  reason: WriteOffReason;
  notes: string | null;
  date: string;
  user_id: string;
  created_at: string;
  storage: { id: string; name: string };
  supply: { id: string; name: string; base_unit: string };
  user: { id: string; name: string };
}

export function createWriteOff(input: CreateWriteOffInput): Promise<WriteOff> {
  return api.post<WriteOff>('/write-offs', input);
}

export interface WriteOffBatchItem {
  supply_id: string;
  quantity: number;
  reason?: WriteOffReason;
  notes?: string;
}

export interface CreateWriteOffBatchInput {
  storage_id: string;
  date: string;
  reason: WriteOffReason;
  notes?: string;
  items: WriteOffBatchItem[];
}

export function createWriteOffBatch(
  input: CreateWriteOffBatchInput,
): Promise<WriteOff[]> {
  return api.post<WriteOff[]>('/write-offs/batch', input);
}

export function listWriteOffs(params: { limit?: number } = {}): Promise<PageResult<WriteOff>> {
  const sp = new URLSearchParams();
  sp.set('limit', String(params.limit ?? 20));
  return api.get<PageResult<WriteOff>>(`/write-offs?${sp.toString()}`);
}
