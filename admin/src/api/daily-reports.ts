import { useAuthStore } from '../store/auth';
import { api, ApiError } from './client';
import type { Paginated } from '../types/api';
import type {
  CashRegister,
  CashRegisterStatus,
} from '../types/operations';

export type DailyReportStatus = 'OPEN' | 'CLOSED';
export type ShiftType = 'REGULAR' | 'PROVISIONAL';

export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AlertType =
  | 'CASH_SHORTAGE'
  | 'CASH_SURPLUS'
  | 'RECURRING_SHORTAGE'
  | 'EXCESSIVE_VOIDS'
  | 'EXCESSIVE_DISCOUNTS'
  | 'UNVERIFIED_PROVISIONAL'
  | 'LATE_VOID';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  data: unknown;
  user_id: string | null;
  shift_report_id: string | null;
  daily_report_id: string | null;
  resolved: boolean;
  resolved_by_id: string | null;
  resolved_at: string | null;
  resolution: string | null;
  created_at: string;
}

export interface ShiftReport {
  id: string;
  cash_register_id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  shift_type: ShiftType;
  opened_at: string;
  closed_at: string;
  gross_sales: number;
  discounts: number;
  comps: number;
  void_total: number;
  void_count: number;
  net_sales: number;
  tax_collected: number;
  total_tickets: number;
  avg_ticket: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  other_sales: number;
  opening_amount: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  actual_cash: number | null;
  cash_variance: number | null;
  alerts?: Alert[];
}

export interface DailyReportShift extends CashRegister {
  type: ShiftType;
  parent_shift_id: string | null;
  requires_verification: boolean;
  verified_by_id: string | null;
  verified_at: string | null;
  verification_notes: string | null;
  daily_report_id: string | null;
  status: CashRegisterStatus;
  verified_by?: { id: string; name: string } | null;
  shift_report?: ShiftReport | null;
}

export interface DailyReport {
  id: string;
  date: string;
  folio: number;
  status: DailyReportStatus;
  gross_sales: number;
  discounts: number;
  comps: number;
  void_total: number;
  void_count: number;
  net_sales: number;
  tax_collected: number;
  total_tickets: number;
  avg_ticket: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  other_sales: number;
  total_opening_amount: number;
  total_cash_in: number;
  total_cash_out: number;
  total_expected_cash: number;
  total_actual_cash: number | null;
  total_cash_variance: number | null;
  sales_by_category: unknown;
  top_products: unknown;
  bottom_products: unknown;
  sales_by_hour: unknown;
  total_shifts: number;
  provisional_shifts: number;
  unverified_provisionals: number;
  peak_hour: number | null;
  slowest_hour: number | null;
  closed_by_id: string | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  closed_by?: { id: string; name: string } | null;
  shifts: DailyReportShift[];
  alerts: Alert[];
}

export interface ListDailyReportParams {
  cursor?: string;
  limit?: number;
  status?: DailyReportStatus;
  from?: string;
  to?: string;
}

export function listDailyReports(params: ListDailyReportParams = {}) {
  return api.get<Paginated<DailyReport>>('/daily-reports', { ...params });
}

export function getDailyReport(id: string) {
  return api.get<DailyReport>(`/daily-reports/${id}`);
}

export function closeDailyReport(input: { notes?: string } = {}) {
  return api.post<DailyReport>('/daily-reports/close', input);
}

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

/**
 * Fetch the printable HTML for a report. Uses the auth client's token so
 * the backend's bearer-token requirement is satisfied — opening the print
 * URL directly in a new tab would arrive unauthenticated, which the route
 * correctly rejects with 401.
 *
 * The caller writes the HTML into an `about:blank` window (rather than
 * minting a blob URL) so the print preview's URL header reads `about:blank`
 * instead of `blob:http://localhost/…` — the latter shows up on the printed
 * sheet by default unless the user manually disables print headers.
 */
export async function fetchDailyReportPrintHtml(id: string): Promise<string> {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_BASE}/daily-reports/${id}/print`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    if (res.status === 401) useAuthStore.getState().logout();
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      message = json.error?.message ?? message;
    } catch {
      /* non-JSON body — keep the default message */
    }
    throw new ApiError({ message }, res.status);
  }
  return res.text();
}
