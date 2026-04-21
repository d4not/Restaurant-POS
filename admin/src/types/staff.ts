/**
 * Types for employees, attendance, and payroll — mirroring the Prisma models
 * returned by /employees, /attendance, and /payroll. Decimal fields come over
 * the wire as strings (Prisma serialization).
 */

import type { UserRole } from './api';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'DAY_OFF' | 'LATE';
export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT',
  'ABSENT',
  'DAY_OFF',
  'LATE',
];

export function attendanceStatusLabel(s: AttendanceStatus): string {
  switch (s) {
    case 'PRESENT': return 'Present';
    case 'ABSENT':  return 'Absent';
    case 'DAY_OFF': return 'Day off';
    case 'LATE':    return 'Late';
  }
}

export type PayrollStatus = 'DRAFT' | 'APPROVED' | 'PAID';

export function payrollStatusLabel(s: PayrollStatus): string {
  switch (s) {
    case 'DRAFT':    return 'Draft';
    case 'APPROVED': return 'Approved';
    case 'PAID':     return 'Paid';
  }
}

/* ── Employee (user with payroll fields) ────────────────── */

export interface Employee {
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

/* ── Attendance ─────────────────────────────────────────── */

export interface Attendance {
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
  user?: { id: string; name: string };
}

export interface CreateAttendanceInput {
  user_id: string;
  date: string;
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

/* ── Payroll ────────────────────────────────────────────── */

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
  bonuses: string;
  net_pay: string;
  status: PayrollStatus;
  notes: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  user?: { id: string; name: string; email: string; position: string | null };
  approver?: { id: string; name: string } | null;
  // present only on the detail endpoint
  attendance?: Array<{
    id: string;
    date: string;
    status: AttendanceStatus;
    reason: string | null;
    is_paid: boolean;
    notes: string | null;
  }>;
}

export interface GeneratePayrollInput {
  week_start: string;
  days_expected?: number;
}

export interface UpdatePayrollInput {
  bonuses?: number;
  notes?: string | null;
  status?: PayrollStatus;
}

export interface GeneratePayrollResult {
  generated: number;
  skipped: number;
  items: PayrollPeriod[];
}
