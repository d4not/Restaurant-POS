import { api } from './client';
import type { Paginated, UserRole } from '../types/api';
import type {
  CreateEmployeeInput,
  Employee,
  UpdateEmployeeInput,
} from '../types/staff';

export interface ListEmployeesParams {
  cursor?: string;
  limit?: number;
  active?: boolean;
  search?: string;
  role?: UserRole;
}

export function listEmployees(params: ListEmployeesParams = {}) {
  const query: Record<string, string | number | undefined> = {
    cursor: params.cursor,
    limit: params.limit,
    search: params.search,
    role: params.role,
  };
  // Backend expects 'true'|'false' strings for the boolean filter.
  if (params.active !== undefined) query.active = params.active ? 'true' : 'false';
  return api.get<Paginated<Employee>>('/employees', query);
}

export function getEmployee(id: string) {
  return api.get<Employee>(`/employees/${id}`);
}

export function createEmployee(input: CreateEmployeeInput) {
  return api.post<Employee>('/employees', input);
}

export function updateEmployee(id: string, input: UpdateEmployeeInput) {
  return api.patch<Employee>(`/employees/${id}`, input);
}

export function deleteEmployee(id: string) {
  return api.delete<Employee>(`/employees/${id}`);
}
