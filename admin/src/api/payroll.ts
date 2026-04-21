import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  GeneratePayrollInput,
  GeneratePayrollResult,
  PayrollPeriod,
  PayrollStatus,
  UpdatePayrollInput,
} from '../types/staff';

export interface ListPayrollParams {
  cursor?: string;
  limit?: number;
  user_id?: string;
  status?: PayrollStatus;
  from?: string;
  to?: string;
}

export function listPayroll(params: ListPayrollParams = {}) {
  return api.get<Paginated<PayrollPeriod>>('/payroll', { ...params });
}

export function getPayroll(id: string) {
  return api.get<PayrollPeriod>(`/payroll/${id}`);
}

export function generatePayroll(input: GeneratePayrollInput) {
  return api.post<GeneratePayrollResult>('/payroll/generate', input);
}

export function updatePayroll(id: string, input: UpdatePayrollInput) {
  return api.patch<PayrollPeriod>(`/payroll/${id}`, input);
}
