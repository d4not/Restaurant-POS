import { api } from './client';
import type { PageResult } from './pagination';

export interface CashRegisterRow {
  id: string;
  user_id: string;
  status: 'OPEN' | 'CLOSED';
  opening_amount: string;
  expected_amount: string;
  actual_amount: string | null;
  difference: string | null;
  opened_at: string;
  closed_at: string | null;
  user: { id: string; name: string };
}

// Find the OPEN register for the signed-in user. Used to attach new orders to
// the current shift — orders cannot be created without one. We don't paginate
// because there's at most one OPEN register per user.
export async function fetchOpenRegister(userId: string): Promise<CashRegisterRow | null> {
  const page = await api.get<PageResult<CashRegisterRow>>(
    `/registers?status=OPEN&user_id=${userId}&limit=1`,
  );
  return page.items[0] ?? null;
}

export interface OpenRegisterInput {
  opening_amount: number;
  notes?: string;
}

export function openRegister(input: OpenRegisterInput): Promise<CashRegisterRow> {
  return api.post<CashRegisterRow>('/registers', input);
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
