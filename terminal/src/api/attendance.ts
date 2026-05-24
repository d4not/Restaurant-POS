import { api } from './client';
import type { PageResult } from './pagination';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'DAY_OFF';

export interface AttendanceRecord {
  id: string;
  user_id: string;
  date: string;
  status: AttendanceStatus;
  reason: string | null;
  is_paid: boolean;
  notes: string | null;
  recorded_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAttendanceInput {
  user_id: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  reason?: string;
  is_paid?: boolean;
  notes?: string;
}

export interface UpdateAttendanceInput {
  status?: AttendanceStatus;
  reason?: string | null;
  is_paid?: boolean;
  notes?: string | null;
}

export interface ListAttendanceFilters {
  user_id?: string;
  status?: AttendanceStatus;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export async function listAttendance(
  filters: ListAttendanceFilters = {},
): Promise<PageResult<AttendanceRecord>> {
  const sp = new URLSearchParams();
  sp.set('limit', String(filters.limit ?? 100));
  if (filters.user_id) sp.set('user_id', filters.user_id);
  if (filters.status) sp.set('status', filters.status);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.cursor) sp.set('cursor', filters.cursor);
  return api.get<PageResult<AttendanceRecord>>(`/attendance?${sp.toString()}`);
}

export function createAttendance(
  input: CreateAttendanceInput,
): Promise<AttendanceRecord> {
  return api.post<AttendanceRecord>(`/attendance`, input);
}

export function updateAttendance(
  id: string,
  input: UpdateAttendanceInput,
): Promise<AttendanceRecord> {
  return api.patch<AttendanceRecord>(`/attendance/${id}`, input);
}

export function deleteAttendance(id: string): Promise<{ id: string }> {
  return api.delete<{ id: string }>(`/attendance/${id}`);
}
