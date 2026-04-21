import { AttendanceStatus, PayrollStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import type {
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
  gross_pay: Decimal;
  deductions: Decimal;
  net_pay: Decimal;
}

/**
 * Payroll formula from SPEC.md §8.4:
 *   daily_rate = weekly_salary / days_expected
 *   deductions = unpaid_absences * daily_rate
 *   net_pay    = weekly_salary - deductions + bonuses
 *
 * Decimal everywhere — centavos are integers in the DB but intermediate
 * daily_rate may have a fractional part, so we keep it in Decimal until the
 * last moment. Rounded on write to satisfy the Decimal(14, 0) column.
 */
export function computePayroll(
  weeklySalary: Decimal,
  daysExpected: number,
  unpaidAbsences: number,
  bonuses: Decimal,
): PayrollMath {
  const dailyRate = weeklySalary.div(daysExpected);
  const deductions = dailyRate.mul(unpaidAbsences).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const gross = weeklySalary;
  const net = gross.sub(deductions).add(bonuses);
  return { gross_pay: gross, deductions, net_pay: net };
}

const payrollInclude = {
  user: { select: { id: true, name: true, email: true, position: true } },
  approver: { select: { id: true, name: true } },
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

      const rows = await tx.attendance.findMany({
        where: {
          user_id: emp.id,
          date: { gte: weekStart, lte: weekEnd },
        },
        select: { status: true, is_paid: true },
      });
      const counts = countAttendance(rows);
      const weeklySalary = new Decimal(emp.weekly_salary ?? 0);
      const bonuses = new Decimal(0);
      const math = computePayroll(weeklySalary, input.days_expected, counts.unpaid_absences, bonuses);

      const created = await tx.payrollPeriod.create({
        data: {
          user_id: emp.id,
          week_start: weekStart,
          week_end: weekEnd,
          days_expected: input.days_expected,
          days_worked: counts.days_worked,
          days_absent: counts.days_absent,
          paid_absences: counts.paid_absences,
          unpaid_absences: counts.unpaid_absences,
          gross_pay: math.gross_pay,
          deductions: math.deductions,
          bonuses,
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
    include: payrollInclude,
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

    // Bonuses and notes can only be edited while the payroll is still DRAFT —
    // once approved the numbers are frozen so the paid record is auditable.
    const mutatingFinancials = input.bonuses !== undefined;
    if (mutatingFinancials && existing.status !== PayrollStatus.DRAFT) {
      throw new ConflictError('bonuses can only be updated while status is DRAFT');
    }

    const nextStatus = input.status ?? existing.status;
    if (input.status !== undefined && !nextStatusAllowed(existing.status, input.status)) {
      throw new ConflictError(
        `invalid status transition ${existing.status} → ${input.status}`,
      );
    }

    const bonuses =
      input.bonuses !== undefined ? new Decimal(input.bonuses) : new Decimal(existing.bonuses);
    const math = computePayroll(
      new Decimal(existing.gross_pay),
      existing.days_expected,
      existing.unpaid_absences,
      bonuses,
    );

    const data: Prisma.PayrollPeriodUpdateInput = {
      bonuses,
      net_pay: math.net_pay,
    };
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.status !== undefined) {
      data.status = input.status;
      // Stamp the approver when crossing into APPROVED; leave it sticky through
      // PAID so we keep the name of whoever signed off.
      if (input.status === PayrollStatus.APPROVED) {
        data.approver = { connect: { id: approverId } };
      }
    }
    void nextStatus;

    return tx.payrollPeriod.update({ where: { id }, data, include: payrollInclude });
  });
}
