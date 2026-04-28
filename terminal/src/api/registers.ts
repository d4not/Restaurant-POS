import { api } from './client';
import type { PageResult } from './pagination';

export type CashRegisterKind = 'NORMAL' | 'PROVISIONAL';

export interface CashRegisterRow {
  id: string;
  user_id: string;
  kind: CashRegisterKind;
  status: 'OPEN' | 'CLOSED';
  opening_amount: string;
  expected_amount: string;
  actual_amount: string | null;
  difference: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_by_user_id: string | null;
  user: { id: string; name: string };
  closed_by: { id: string; name: string } | null;
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
  notes?: string;
}

export function closeRegister(
  registerId: string,
  input: CloseRegisterInput,
): Promise<CashRegisterRow> {
  return api.post<CashRegisterRow>(`/registers/${registerId}/close`, input);
}
