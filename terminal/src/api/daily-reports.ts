import { api, ApiError, getApiBase } from './client';
import { useSession } from '../store/session';

export interface DailyReportSummary {
  id: string;
  date: string;
  folio: number;
  status: 'OPEN' | 'CLOSED';
  total_shifts: number;
  total_tickets: number;
  gross_sales: number;
  net_sales: number;
  total_cash_variance: number | null;
  closed_at: string | null;
}

export interface CloseDailyReportInput {
  notes?: string;
}

// Closes today's day. Backend requires MANAGER or ADMIN role; CASHIER will
// hit a 403. Caller must ensure no shifts are still OPEN — singleton-shift
// invariant means closing the current shift first satisfies that.
export function closeDailyReport(
  input: CloseDailyReportInput = {},
): Promise<DailyReportSummary> {
  return api.post<DailyReportSummary>('/daily-reports/close', input);
}

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// Returns today's daily report row if one already exists, else null. Used by
// the End-day affordances to suppress the action when the day is already
// closed so the user never hits a 409 from the unique-date constraint.
export async function fetchTodayDailyReport(): Promise<DailyReportSummary | null> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  const qs = new URLSearchParams({
    from: start.toISOString(),
    to: end.toISOString(),
    limit: '1',
  });
  const res = await api.get<Paginated<DailyReportSummary>>(`/daily-reports?${qs}`);
  return res.items[0] ?? null;
}

// List daily reports inside an optional date range. The audit view uses this
// to decorate day groups with their Z-folio + view/reopen actions.
export async function listDailyReports(
  range: { from?: string; to?: string } = {},
): Promise<DailyReportSummary[]> {
  const qs = new URLSearchParams();
  if (range.from) qs.set('from', range.from);
  if (range.to) qs.set('to', range.to);
  qs.set('limit', '100');
  const res = await api.get<Paginated<DailyReportSummary>>(`/daily-reports?${qs}`);
  return res.items;
}

// Reopens a closed DailyReport. Server returns 204; the call resolves with
// no data. Caller invalidates ['daily-reports'] and ['admin','shifts'] to
// refresh the audit view.
export function reopenDailyReport(id: string): Promise<void> {
  return api.post<void>(`/daily-reports/${id}/reopen`);
}

// Fetches the printable HTML for a daily report. Mirrors the admin helper
// so the audit view can open the report in a popup the same way.
export async function fetchDailyReportPrintHtml(id: string): Promise<string> {
  const token = useSession.getState().token;
  const res = await fetch(`${getApiBase()}/daily-reports/${id}/print`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      message = json.error?.message ?? message;
    } catch {
      /* non-JSON body — keep the default message */
    }
    throw new ApiError(message, res.status);
  }
  return res.text();
}
