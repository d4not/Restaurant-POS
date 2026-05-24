import { api } from './client';
import type { PageResult } from './pagination';
import type { AttendanceRecord } from './attendance';

export type PayrollStatus = 'DRAFT' | 'APPROVED' | 'PAID';

export interface PayrollPeriod {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  days_expected: number;
  days_worked: number;
  days_absent: number;
  paid_absences: number;
  unpaid_absences: number;
  gross_pay: string;
  deductions: string;
  tab_deductions: string;
  bonuses: string;
  net_pay: string;
  status: PayrollStatus;
  notes: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  user: { id: string; name: string; email: string; position: string | null };
  approver: { id: string; name: string } | null;
}

// Detail endpoint inlines the attendance breakdown so the admin sees which
// days drove the deduction without a second call.
export interface PayrollPeriodDetail extends PayrollPeriod {
  attendance: Array<Pick<AttendanceRecord, 'id' | 'date' | 'status' | 'reason' | 'is_paid' | 'notes'>>;
}

export interface GeneratePayrollInput {
  week_start: string; // YYYY-MM-DD, must be a Monday
  days_expected?: number;
}

export interface GeneratePayrollResult {
  generated: number;
  skipped: number;
  items: PayrollPeriod[];
}

export interface UpdatePayrollInput {
  bonuses?: number;
  notes?: string | null;
  status?: PayrollStatus;
}

export interface ListPayrollFilters {
  user_id?: string;
  status?: PayrollStatus;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export async function listPayroll(
  filters: ListPayrollFilters = {},
): Promise<PageResult<PayrollPeriod>> {
  const sp = new URLSearchParams();
  sp.set('limit', String(filters.limit ?? 50));
  if (filters.user_id) sp.set('user_id', filters.user_id);
  if (filters.status) sp.set('status', filters.status);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.cursor) sp.set('cursor', filters.cursor);
  return api.get<PageResult<PayrollPeriod>>(`/payroll?${sp.toString()}`);
}

export function getPayroll(id: string): Promise<PayrollPeriodDetail> {
  return api.get<PayrollPeriodDetail>(`/payroll/${id}`);
}

export function generatePayroll(
  input: GeneratePayrollInput,
): Promise<GeneratePayrollResult> {
  return api.post<GeneratePayrollResult>(`/payroll/generate`, input);
}

export function updatePayroll(
  id: string,
  input: UpdatePayrollInput,
): Promise<PayrollPeriod> {
  return api.patch<PayrollPeriod>(`/payroll/${id}`, input);
}
