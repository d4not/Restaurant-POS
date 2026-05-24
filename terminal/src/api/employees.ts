import { api } from './client';
import type { PageResult } from './pagination';

export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'BARISTA' | 'WAITER';

// Lightweight row used by selectors and dropdowns.
export interface EmployeeSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

// Full record returned by /employees and /employees/:id — payroll fields
// included so the admin roster + detail screens can render without an extra
// round trip.
export interface EmployeeRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  weekly_salary: string | null;
  hire_date: string | null;
  position: string | null;
  phone: string | null;
  emergency_contact: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEmployeeInput {
  name: string;
  email: string;
  pin: string;
  password: string;
  role: UserRole;
  weekly_salary: number;
  hire_date?: string;
  position?: string;
  phone?: string;
  emergency_contact?: string;
  notes?: string;
}

export interface UpdateEmployeeInput {
  name?: string;
  email?: string;
  pin?: string;
  password?: string;
  role?: UserRole;
  active?: boolean;
  weekly_salary?: number | null;
  hire_date?: string | null;
  position?: string | null;
  phone?: string | null;
  emergency_contact?: string | null;
  notes?: string | null;
}

export interface ListEmployeeFilters {
  active?: boolean;
  search?: string;
  role?: UserRole;
  limit?: number;
  cursor?: string;
}

// One-shot drain of active employees. Cafés have few employees so a single
// page is usually enough; we paginate just to be defensive.
export async function fetchAllEmployees(): Promise<EmployeeSummary[]> {
  const out: EmployeeSummary[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page: PageResult<EmployeeSummary> = await api.get<PageResult<EmployeeSummary>>(
      `/employees?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

// Full-record list. The roster screen calls this with its own filters.
export async function listEmployees(
  filters: ListEmployeeFilters = {},
): Promise<PageResult<EmployeeRecord>> {
  const sp = new URLSearchParams();
  sp.set('limit', String(filters.limit ?? 100));
  if (filters.active !== undefined) sp.set('active', filters.active ? 'true' : 'false');
  if (filters.search) sp.set('search', filters.search);
  if (filters.role) sp.set('role', filters.role);
  if (filters.cursor) sp.set('cursor', filters.cursor);
  return api.get<PageResult<EmployeeRecord>>(`/employees?${sp.toString()}`);
}

export function getEmployee(id: string): Promise<EmployeeRecord> {
  return api.get<EmployeeRecord>(`/employees/${id}`);
}

export function createEmployee(input: CreateEmployeeInput): Promise<EmployeeRecord> {
  return api.post<EmployeeRecord>(`/employees`, input);
}

export function updateEmployee(
  id: string,
  input: UpdateEmployeeInput,
): Promise<EmployeeRecord> {
  return api.patch<EmployeeRecord>(`/employees/${id}`, input);
}

export function deactivateEmployee(id: string): Promise<EmployeeRecord> {
  return api.delete<EmployeeRecord>(`/employees/${id}`);
}
