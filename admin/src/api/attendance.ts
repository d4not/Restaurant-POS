import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  Attendance,
  AttendanceStatus,
  CreateAttendanceInput,
  UpdateAttendanceInput,
} from '../types/staff';

export interface ListAttendanceParams {
  cursor?: string;
  limit?: number;
  user_id?: string;
  status?: AttendanceStatus;
  from?: string;
  to?: string;
}

export function listAttendance(params: ListAttendanceParams = {}) {
  return api.get<Paginated<Attendance>>('/attendance', { ...params });
}

export function logAttendance(input: CreateAttendanceInput) {
  return api.post<Attendance>('/attendance', input);
}

export function updateAttendance(id: string, input: UpdateAttendanceInput) {
  return api.patch<Attendance>(`/attendance/${id}`, input);
}

export function deleteAttendance(id: string) {
  return api.delete<void>(`/attendance/${id}`);
}
