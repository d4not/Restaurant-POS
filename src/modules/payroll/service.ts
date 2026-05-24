import {
  AttendanceStatus,
  OrderType,
  PayrollAdjustmentType,
  PayrollStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import { countActiveDays } from '../schedule/service.js';
import type {
  CreateAdjustmentInput,
  GeneratePayrollInput,
  ListPayrollQuery,
  UpdatePayrollInput,
} from './schema.js';

/**
 * Snap a Date to midnight UTC. Match attendance normalization so week boundary
 * comparisons don't drift across timezones.
 */
function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  ));
}

// JS Sunday=0 → Monday=1. Anything else is a validation error at the API edge.
function isMonday(date: Date): boolean {
  return date.getUTCDay() === 1;
}

interface AttendanceCounts {
  days_worked: number;
  days_absent: number;
  paid_absences: number;
  unpaid_absences: number;
}

function countAttendance(rows: Array<{ status: AttendanceStatus; is_paid: boolean }>): AttendanceCounts {
  let worked = 0;
  let absent = 0;
  let paidAbsent = 0;
  let unpaidAbsent = 0;
  for (const r of rows) {
    if (r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE) {
      worked += 1;
    } else if (r.status === AttendanceStatus.ABSENT) {
      absent += 1;
      if (r.is_paid) paidAbsent += 1;
      else unpaidAbsent += 1;
    }
    // DAY_OFF is neither worked nor absent — excluded from all counters.
  }
  return {
    days_worked: worked,
    days_absent: absent,
    paid_absences: paidAbsent,
    unpaid_absences: unpaidAbsent,
  };
}

interface PayrollMath {
  // Itemized breakdown (Phase 11):
  absence_deductions: Decimal;
  // Aggregate mirrors maintained for API back-compat:
  deductions: Decimal;
  bonuses: Decimal;
  gross_pay: Decimal;
  net_pay: Decimal;
}

interface ComputeArgs {
  weeklySalary: Decimal;
  daysExpected: number;
  unpaidAbsences: number;
  tabDeductions?: Decimal;
  adjustmentBonuses?: Decimal;
  adjustmentDeductions?: Decimal;
  tipsAmount?: Decimal;
}

/**
 * Itemized payroll formula (Phase 11):
 *   daily_rate            = weekly_salary / days_expected
 *   absence_deductions    = round(daily_rate * unpaid_absences)
 *   net_pay               = weekly_salary
 *                         - absence_deductions
 *                         - tab_deductions
 *                         - adjustment_deductions
 *                         + adjustment_bonuses
 *                         + tips_amount
 *
 * Mirrors for back-compat:
 *   deductions = absence_deductions + adjustment_deductions
 *   bonuses    = adjustment_bonuses + tips_amount
 *
 * Old callers reading `deductions` and `bonuses` see the same numeric shape
 * as before; the legacy formula (gross - deductions - tab + bonuses) yields
 * the same net.
 */
export function computePayroll(args: ComputeArgs): PayrollMath {
  const tabDeductions = args.tabDeductions ?? new Decimal(0);
  const adjustmentBonuses = args.adjustmentBonuses ?? new Decimal(0);
  const adjustmentDeductions = args.adjustmentDeductions ?? new Decimal(0);
  const tipsAmount = args.tipsAmount ?? new Decimal(0);

  const dailyRate = args.weeklySalary.div(args.daysExpected);
  const absenceDeductions = dailyRate
    .mul(args.unpaidAbsences)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const deductionsMirror = absenceDeductions.add(adjustmentDeductions);
  const bonusesMirror = adjustmentBonuses.add(tipsAmount);

  const gross = args.weeklySalary;
  const net = gross
    .sub(absenceDeductions)
    .sub(tabDeductions)
    .sub(adjustmentDeductions)
    .add(adjustmentBonuses)
    .add(tipsAmount);

  return {
    absence_deductions: absenceDeductions,
    deductions: deductionsMirror,
    bonuses: bonusesMirror,
    gross_pay: gross,
    net_pay: net,
  };
}

/**
 * Sum PAYROLL_DEDUCT payments on this employee's EMPLOYEE orders settled
 * during [start, end] (inclusive). Caller is responsible for the tx scope.
 */
async function sumTabDeductions(
  tx: Prisma.TransactionClient,
  userId: string,
  start: Date,
  end: Date,
): Promise<Decimal> {
  const agg = await tx.payment.aggregate({
    where: {
      method: PaymentMethod.PAYROLL_DEDUCT,
      created_at: { gte: start, lte: end },
      order: {
        order_type: OrderType.EMPLOYEE,
        employee_user_id: userId,
      },
    },
    _sum: { amount: true },
  });
  return new Decimal(agg._sum.amount ?? 0);
}

const payrollInclude = {
  user: { select: { id: true, name: true, email: true, position: true } },
  approver: { select: { id: true, name: true } },
} satisfies Prisma.PayrollPeriodInclude;

const payrollDetailInclude = {
  ...payrollInclude,
  adjustments: {
    orderBy: { created_at: 'asc' as const },
    include: {
      creator: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PayrollPeriodInclude;

export async function generatePayroll(input: GeneratePayrollInput) {
  const weekStart = toUtcDate(input.week_start);
  if (!isMonday(weekStart)) {
    throw new BadRequestError('week_start must be a Monday');
  }
  const weekEnd = addDaysUtc(weekStart, 6); // Sunday

  const employees = await prisma.user.findMany({
    where: { active: true, weekly_salary: { not: null } },
    select: { id: true, weekly_salary: true },
    orderBy: { name: 'asc' },
  });

  if (employees.length === 0) return { generated: 0, skipped: 0, items: [] as unknown[] };

  return prisma.$transaction(async (tx) => {
    let generated = 0;
    let skipped = 0;
    const items: Array<Awaited<ReturnType<typeof tx.payrollPeriod.create>>> = [];

    for (const emp of employees) {
      const duplicate = await tx.payrollPeriod.findUnique({
        where: { user_id_week_start: { user_id: emp.id, week_start: weekStart } },
        select: { id: true },
      });
      if (duplicate) {
        skipped += 1;
        continue;
      }

      // days_expected derivation: prefer the employee's schedule, fall back to
      // the API-provided default (currently 6). The fallback lets us generate
      // payroll for employees whose schedule hasn't been set up yet without
      // crashing — Phase 6 will tighten this and require a schedule.
      const scheduleDays = await countActiveDays(emp.id, tx);
      const daysExpected = scheduleDays > 0 ? scheduleDays : input.days_expected;

      const rows = await tx.attendance.findMany({
        where: {
          user_id: emp.id,
          date: { gte: weekStart, lte: weekEnd },
        },
        select: { status: true, is_paid: true },
      });
      const counts = countAttendance(rows);
      const weeklySalary = new Decimal(emp.weekly_salary ?? 0);
      const tabDeductions = await sumTabDeductions(tx, emp.id, weekStart, weekEnd);
      const math = computePayroll({
        weeklySalary,
        daysExpected,
        unpaidAbsences: counts.unpaid_absences,
        tabDeductions,
      });

      const created = await tx.payrollPeriod.create({
        data: {
          user_id: emp.id,
          week_start: weekStart,
          week_end: weekEnd,
          days_expected: daysExpected,
          days_worked: counts.days_worked,
          days_absent: counts.days_absent,
          paid_absences: counts.paid_absences,
          unpaid_absences: counts.unpaid_absences,
          gross_pay: math.gross_pay,
          deductions: math.deductions,
          tab_deductions: tabDeductions,
          bonuses: math.bonuses,
          absence_deductions: math.absence_deductions,
          adjustment_bonuses: new Decimal(0),
          adjustment_deductions: new Decimal(0),
          tips_amount: new Decimal(0),
          net_pay: math.net_pay,
          status: PayrollStatus.DRAFT,
        },
        include: payrollInclude,
      });
      items.push(created);
      generated += 1;
    }

    return { generated, skipped, items };
  });
}

export async function listPayroll(query: ListPayrollQuery) {
  const where: Prisma.PayrollPeriodWhereInput = {
    ...(query.user_id ? { user_id: query.user_id } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          week_start: {
            ...(query.from ? { gte: toUtcDate(query.from) } : {}),
            ...(query.to ? { lte: toUtcDate(query.to) } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.payrollPeriod.findMany({
    where,
    orderBy: [{ week_start: 'desc' }, { id: 'asc' }],
    include: payrollInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getPayroll(id: string) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id },
    include: payrollDetailInclude,
  });
  if (!period) throw new NotFoundError('PayrollPeriod');

  // Inline the attendance breakdown so the detail endpoint is one round-trip
  // for the UI — an admin reviewing payroll wants to see which days drove the
  // deduction without calling the attendance endpoint separately.
  const attendance = await prisma.attendance.findMany({
    where: {
      user_id: period.user_id,
      date: { gte: period.week_start, lte: period.week_end },
    },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      date: true,
      status: true,
      reason: true,
      is_paid: true,
      notes: true,
    },
  });

  return { ...period, attendance };
}

/**
 * Valid transitions: DRAFT→APPROVED, APPROVED→PAID. No reverts, no skips.
 */
function nextStatusAllowed(current: PayrollStatus, target: PayrollStatus): boolean {
  if (current === target) return true;
  if (current === PayrollStatus.DRAFT && target === PayrollStatus.APPROVED) return true;
  if (current === PayrollStatus.APPROVED && target === PayrollStatus.PAID) return true;
  return false;
}

export async function updatePayroll(
  id: string,
  approverId: string,
  input: UpdatePayrollInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payrollPeriod.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('PayrollPeriod');

    if (input.status !== undefined && !nextStatusAllowed(existing.status, input.status)) {
      throw new ConflictError(
        `invalid status transition ${existing.status} → ${input.status}`,
      );
    }

    const data: Prisma.PayrollPeriodUpdateInput = {};
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.status !== undefined) {
      data.status = input.status;
      // Stamp the approver when crossing into APPROVED; leave it sticky through
      // PAID so we keep the name of whoever signed off.
      if (input.status === PayrollStatus.APPROVED) {
        data.approver = { connect: { id: approverId } };
      }
    }

    return tx.payrollPeriod.update({
      where: { id },
      data,
      include: payrollDetailInclude,
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Adjustments (itemized bonuses / deductions)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Recompute the period's `adjustment_bonuses`, `adjustment_deductions`,
 * legacy `bonuses`/`deductions` mirrors, and `net_pay` from the current
 * adjustments + persisted absence/tip totals. Called after any adjustment
 * mutation and after a tip pool is closed/reopened.
 *
 * Returns the updated period for the caller's convenience.
 */
export async function recalcPayroll(
  tx: Prisma.TransactionClient,
  periodId: string,
) {
  const period = await tx.payrollPeriod.findUnique({
    where: { id: periodId },
    include: { adjustments: true },
  });
  if (!period) throw new NotFoundError('PayrollPeriod');

  const adjustmentBonuses = period.adjustments
    .filter((a) => a.type === PayrollAdjustmentType.BONUS)
    .reduce((sum, a) => sum.add(new Decimal(a.amount)), new Decimal(0))
    // The tips_amount column already captures TIPS-sourced bonuses; subtracting
    // them here keeps `adjustment_bonuses` purely about manual edits, otherwise
    // the tip portion would be double-counted in the mirror.
    .sub(
      period.adjustments
        .filter(
          (a) =>
            a.type === PayrollAdjustmentType.BONUS && a.source_kind === 'TIPS',
        )
        .reduce((sum, a) => sum.add(new Decimal(a.amount)), new Decimal(0)),
    );

  const adjustmentDeductions = period.adjustments
    .filter((a) => a.type === PayrollAdjustmentType.DEDUCTION)
    .reduce((sum, a) => sum.add(new Decimal(a.amount)), new Decimal(0));

  const math = computePayroll({
    weeklySalary: new Decimal(period.gross_pay),
    daysExpected: period.days_expected,
    unpaidAbsences: period.unpaid_absences,
    tabDeductions: new Decimal(period.tab_deductions),
    adjustmentBonuses,
    adjustmentDeductions,
    tipsAmount: new Decimal(period.tips_amount),
  });

  return tx.payrollPeriod.update({
    where: { id: periodId },
    data: {
      absence_deductions: math.absence_deductions,
      adjustment_bonuses: adjustmentBonuses,
      adjustment_deductions: adjustmentDeductions,
      bonuses: math.bonuses,
      deductions: math.deductions,
      net_pay: math.net_pay,
    },
    include: payrollDetailInclude,
  });
}

export async function addAdjustment(
  periodId: string,
  createdByUserId: string,
  input: CreateAdjustmentInput,
) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, status: true },
    });
    if (!period) throw new NotFoundError('PayrollPeriod');
    if (period.status !== PayrollStatus.DRAFT) {
      throw new ConflictError('Adjustments can only be added while payroll is DRAFT');
    }
    await tx.payrollAdjustment.create({
      data: {
        payroll_period_id: periodId,
        type: input.type,
        label: input.label,
        amount: new Decimal(input.amount),
        source_kind: 'MANUAL',
        created_by_user_id: createdByUserId,
      },
    });
    return recalcPayroll(tx, periodId);
  });
}

export async function removeAdjustment(periodId: string, adjustmentId: string) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, status: true },
    });
    if (!period) throw new NotFoundError('PayrollPeriod');
    if (period.status !== PayrollStatus.DRAFT) {
      throw new ConflictError('Adjustments can only be removed while payroll is DRAFT');
    }
    const adj = await tx.payrollAdjustment.findUnique({
      where: { id: adjustmentId },
      select: { id: true, payroll_period_id: true, source_kind: true },
    });
    if (!adj || adj.payroll_period_id !== periodId) {
      throw new NotFoundError('PayrollAdjustment');
    }
    // TIPS-sourced rows are pinned read-only — they reflect a closed pool's
    // distribution. Undoing them requires reopening the pool so the audit
    // trail stays consistent on both sides.
    if (adj.source_kind === 'TIPS') {
      throw new ConflictError(
        'Tip-pool adjustments cannot be removed directly — reopen the tip pool instead',
      );
    }
    await tx.payrollAdjustment.delete({ where: { id: adjustmentId } });
    return recalcPayroll(tx, periodId);
  });
}
