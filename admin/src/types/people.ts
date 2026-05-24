/**
 * People-module types: payroll adjustments, schedule slots, tip pools.
 * Mirror the backend's Prisma response shapes — decimal fields cross the
 * wire as strings (Prisma serialization).
 */

import type { UserRole } from './api';

/* ── Payroll adjustments ─────────────────────────────────── */

export type PayrollAdjustmentType = 'BONUS' | 'DEDUCTION';

export type PayrollAdjustmentSource = 'MANUAL' | 'TIPS';

export interface PayrollAdjustment {
  id: string;
  payroll_period_id?: string;
  type: PayrollAdjustmentType;
  label: string;
  amount: string;
  source_kind: PayrollAdjustmentSource;
  source_id: string | null;
  created_by_user_id: string;
  creator?: { id: string; name: string } | null;
  created_at: string;
}

export interface CreateAdjustmentInput {
  type: PayrollAdjustmentType;
  label: string;
  /** Centavos — must be a positive integer. */
  amount: number;
}

/* ── Schedule ────────────────────────────────────────────── */

export interface ScheduleSlot {
  id: string;
  day_of_week: number;
  start_minutes: number;
  end_minutes: number;
  active: boolean;
}

/** Always 7 entries indexed by day_of_week (0=Mon..6=Sun). null = day off. */
export type Week = (ScheduleSlot | null)[];

export interface RosterRow {
  user_id: string;
  user_name: string;
  position: string | null;
  role: UserRole;
  week: Week;
}

export interface ReplaceWeekInput {
  slots: Array<{
    day_of_week: number;
    start_minutes: number;
    end_minutes: number;
    active?: boolean;
  }>;
}

export interface UpsertDayInput {
  start_minutes: number;
  end_minutes: number;
  active?: boolean;
}

/* ── Tip pools ───────────────────────────────────────────── */

export type TipPoolStatus = 'OPEN' | 'CLOSED';

export interface TipAllocation {
  id: string;
  pool_id: string;
  user_id: string;
  included: boolean;
  attended_days: number;
  base_amount: string;
  override_amount: string | null;
  final_amount: string;
  note: string | null;
  user?: {
    id: string;
    name: string;
    position: string | null;
    role: UserRole;
  };
}

export interface TipPool {
  id: string;
  week_start: string;
  week_end: string;
  total_collected: string;
  total_distributed: string;
  status: TipPoolStatus;
  closed_by_user_id: string | null;
  closed_at: string | null;
  closer?: { id: string; name: string } | null;
  allocations: TipAllocation[];
}

export interface UpdateAllocationInput {
  included?: boolean;
  /** Pass null to clear an override and fall back to base_amount. */
  override_amount?: number | null;
  note?: string | null;
}
