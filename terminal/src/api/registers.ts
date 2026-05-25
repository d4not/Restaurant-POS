import { api } from './client';
import type { PageResult } from './pagination';

export type CashMovementKind = 'CASH_IN' | 'CASH_OUT';

export interface CashMovementRow {
  id: string;
  register_id: string;
  user_id: string;
  type: CashMovementKind;
  amount: string;
  reason: string;
  created_at: string;
}

// Per-shift cash + payment aggregates the backend computes on every register
// read. The admin Shifts view renders straight off this — no waiting on the
// ShiftReport snapshot generated at close.
export interface RegisterTotals {
  cash_in: string;
  cash_out: string;
  // Net cash that hit the drawer (sum of CASH payments − change given).
  cash_sales: string;
  card_sales: string;
  transfer_sales: string;
  // Bucket for any other method (PAYROLL_DEDUCT today; future vouchers, etc.).
  other_sales: string;
  // Live expected cash: opening + cash_sales + cash_in − cash_out. Mirrors
  // the close-flow math so the OPEN-shift number lines up with whatever a
  // close would compute right now.
  expected_cash: string;
  total_sales: string;
}

export interface CashRegisterRow {
  id: string;
  user_id: string;
  status: 'OPEN' | 'CLOSED';
  is_provisional: boolean;
  opening_amount: string;
  expected_amount: string;
  actual_amount: string | null;
  difference: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_by_user_id: string | null;
  notes?: string | null;
  user: { id: string; name: string; role?: string };
  closed_by: { id: string; name: string } | null;
  // Provisional verification snapshot (set when a cashier verifies a
  // floor-staff-opened shift mid-day).
  provisional_verified_by_id?: string | null;
  provisional_verified_at?: string | null;
  provisional_expected_amount?: string | null;
  provisional_actual_amount?: string | null;
  provisional_difference?: string | null;
  provisional_verified_by?: { id: string; name: string } | null;
  // Cash movements attached to this register, oldest-first. Present on
  // every read; optional on the type because legacy callers may not need it.
  cash_movements?: CashMovementRow[];
  // Backend-computed per-shift totals; present on getRegister/listRegisters.
  totals?: RegisterTotals;
}

// Variant used by the admin Shifts view: totals and cash_movements are
// guaranteed by the list/get backend endpoints, so the view doesn't have to
// null-check on each access.
export interface CashRegisterDetail extends CashRegisterRow {
  cash_movements: CashMovementRow[];
  totals: RegisterTotals;
  shift_report?: { id: string } | null;
}

// Find the OPEN register for the signed-in user. Used by the cashier-only
// shift pill (showing whether *they* own the open shift). Order routing uses
// fetchCurrentRegister instead — the system runs at most one OPEN shift at
// a time and any user can attach orders to it.
export async function fetchOpenRegister(userId: string): Promise<CashRegisterRow | null> {
  const page = await api.get<PageResult<CashRegisterRow>>(
    `/registers?status=OPEN&user_id=${userId}&limit=1`,
  );
  return page.items[0] ?? null;
}

// Singleton lookup — returns whichever shift is currently OPEN, regardless of
// who opened it. Drives the entry-gate (no shift → NoActiveShiftScreen) and
// the topbar's provisional banner.
export async function fetchCurrentRegister(): Promise<CashRegisterRow | null> {
  return api.get<CashRegisterRow | null>(`/registers/current`);
}

export interface OpenRegisterInput {
  opening_amount: number;
  denomination_breakdown?: Record<string, number>;
  notes?: string;
}

export function openRegister(input: OpenRegisterInput): Promise<CashRegisterRow> {
  return api.post<CashRegisterRow>('/registers', input);
}

export interface OpenProvisionalRegisterInput {
  opening_amount?: number;
  notes?: string;
}

// Open an emergency / provisional shift. Allowed for any authenticated user;
// barista/waiter use this when no cashier is on site yet. The arriving
// cashier must close it with a counted actual_amount.
export function openProvisionalRegister(
  input: OpenProvisionalRegisterInput = {},
): Promise<CashRegisterRow> {
  return api.post<CashRegisterRow>('/registers/provisional', input);
}

export interface CloseRegisterInput {
  actual_amount: number;
  denomination_breakdown?: Record<string, number>;
  notes?: string;
}

export function closeRegister(
  registerId: string,
  input: CloseRegisterInput,
): Promise<CashRegisterRow> {
  return api.post<CashRegisterRow>(`/registers/${registerId}/close`, input);
}

// Today's shifts — used by Order History to render section headers per turno.
// Pulls both OPEN and CLOSED registers whose opened_at falls within the day so
// a cashier who already closed their shift still sees it grouped above their
// successor's.
export async function fetchShiftsForRange(
  from: Date,
  to: Date,
): Promise<CashRegisterRow[]> {
  const params = new URLSearchParams();
  params.set('from', from.toISOString());
  params.set('to', to.toISOString());
  params.set('limit', '50');
  const page = await api.get<PageResult<CashRegisterRow>>(
    `/registers?${params.toString()}`,
  );
  return page.items;
}

export interface FetchAllRegistersInput {
  status?: 'OPEN' | 'CLOSED';
  user_id?: string;
  from?: string;
  to?: string;
  limit?: number;
}

// Admin Shifts view feed. Returns the full per-shift detail (totals,
// cash_movements, provisional snapshot) the audit table renders. Defaults to
// a healthy page size (100) since the view groups by day and a busy
// restaurant can easily run 3–5 shifts per day plus end-day cuts.
export async function fetchAllRegisters(
  input: FetchAllRegistersInput = {},
): Promise<CashRegisterDetail[]> {
  const params = new URLSearchParams();
  if (input.status) params.set('status', input.status);
  if (input.user_id) params.set('user_id', input.user_id);
  if (input.from) params.set('from', input.from);
  if (input.to) params.set('to', input.to);
  params.set('limit', String(input.limit ?? 100));
  const page = await api.get<PageResult<CashRegisterDetail>>(
    `/registers?${params.toString()}`,
  );
  return page.items;
}

export interface VerifyProvisionalInput {
  actual_amount: number;
  denomination_breakdown?: Record<string, number>;
  notes?: string;
}

// Mid-day cashier-to-cashier verification of a provisional shift. The
// counted diff lands on provisional_* fields, is_provisional flips to
// false, and the SAME register continues running.
export function verifyProvisionalRegister(
  registerId: string,
  input: VerifyProvisionalInput,
): Promise<CashRegisterRow> {
  return api.post<CashRegisterRow>(
    `/registers/${registerId}/verify-provisional`,
    input,
  );
}

export function flagShiftForReview(registerId: string): Promise<void> {
  return api.post(`/registers/${registerId}/flag-review`);
}
