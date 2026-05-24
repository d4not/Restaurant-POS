import {
  AttendanceStatus,
  OrderStatus,
  PayrollAdjustmentType,
  PayrollStatus,
  Prisma,
  TipPoolStatus,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import { recalcPayroll } from '../payroll/service.js';
import type {
  ListPoolsQuery,
  UpdateAllocationInput,
} from './schema.js';

// ────────────────────────────────────────────────────────────────────────────
// Week helpers — copied from the project's existing util conventions so this
// module stays self-contained.
// ────────────────────────────────────────────────────────────────────────────
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

// JS Sunday=0 → walk back to the Monday that owns this week. Matches the
// payroll week_start convention.
function mondayOf(date: Date): Date {
  const d = toUtcDate(date);
  const dow = d.getUTCDay(); // 0=Sun ... 6=Sat
  const back = dow === 0 ? 6 : dow - 1;
  return addDaysUtc(d, -back);
}

const poolInclude = {
  allocations: {
    orderBy: { user_id: 'asc' as const },
    include: {
      user: { select: { id: true, name: true, position: true, role: true } },
    },
  },
  closer: { select: { id: true, name: true } },
} satisfies Prisma.TipPoolInclude;

// ────────────────────────────────────────────────────────────────────────────
// Read paths
// ────────────────────────────────────────────────────────────────────────────

export async function listPools(query: ListPoolsQuery) {
  const where: Prisma.TipPoolWhereInput = {
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
  const rows = await prisma.tipPool.findMany({
    where,
    orderBy: [{ week_start: 'desc' }, { id: 'asc' }],
    include: poolInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

/**
 * Get-or-create the OPEN pool for the Monday of `date`. The lazy-create lets
 * the admin web open the Tips page without having to seed pools from a cron
 * job — the first read materialises the row.
 */
export async function getOrCreateCurrentPool(date: Date | undefined) {
  const monday = mondayOf(date ?? new Date());
  const sunday = addDaysUtc(monday, 6);
  // Try-then-create; race with another caller is harmless because of the
  // @@unique([week_start]) constraint — the loser falls back to a read.
  const existing = await prisma.tipPool.findUnique({
    where: { week_start: monday },
  });
  if (existing) return refreshPool(existing.id);
  try {
    await prisma.tipPool.create({
      data: { week_start: monday, week_end: sunday },
    });
  } catch (err) {
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== 'P2002'
    ) {
      throw err;
    }
  }
  const row = await prisma.tipPool.findUniqueOrThrow({
    where: { week_start: monday },
  });
  return refreshPool(row.id);
}

export async function getPool(poolId: string) {
  // Always refresh on read so the admin web sees up-to-date totals without
  // the caller having to remember to POST /refresh first.
  return refreshPool(poolId);
}

// ────────────────────────────────────────────────────────────────────────────
// Refresh — recompute total_collected and per-employee allocations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Re-aggregate the pool from the source of truth: sum payment.tip_amount in
 * the [week_start, week_end+1day) window for PAID orders, then upsert one
 * TipAllocation per active salaried employee with PRESENT/LATE attendance in
 * that week. Re-computes base_amount and final_amount.
 *
 * Safe to call repeatedly. No-op on CLOSED pools (allocations are frozen
 * once distribution happens).
 */
export async function refreshPool(poolId: string) {
  return prisma.$transaction(async (tx) => {
    const pool = await tx.tipPool.findUnique({
      where: { id: poolId },
      include: poolInclude,
    });
    if (!pool) throw new NotFoundError('TipPool');
    if (pool.status === TipPoolStatus.CLOSED) {
      return pool;
    }

    const weekStart = pool.week_start;
    const weekEndExclusive = addDaysUtc(pool.week_end, 1);

    // Sum tips collected this week across all methods, ignoring voided /
    // cancelled orders. Using payment.created_at (the settlement timestamp)
    // matches the cash register's tip aggregation.
    const tipAgg = await tx.payment.aggregate({
      where: {
        created_at: { gte: weekStart, lt: weekEndExclusive },
        order: { status: OrderStatus.PAID },
      },
      _sum: { tip_amount: true },
    });
    const totalCollected = new Decimal(tipAgg._sum.tip_amount ?? 0);

    // Eligible employees: active + has weekly_salary set. Includes everyone
    // who could possibly receive tips this week. Manager toggles inclusion
    // per-row via PATCH allocation.
    const employees = await tx.user.findMany({
      where: { active: true, weekly_salary: { not: null } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    // Attendance window: weekStart..weekEnd inclusive.
    const attendanceRows = await tx.attendance.findMany({
      where: {
        user_id: { in: employees.map((e) => e.id) },
        date: { gte: weekStart, lte: pool.week_end },
        status: { in: [AttendanceStatus.PRESENT, AttendanceStatus.LATE] },
      },
      select: { user_id: true },
    });
    const attendedDaysByUser = new Map<string, number>();
    for (const row of attendanceRows) {
      attendedDaysByUser.set(
        row.user_id,
        (attendedDaysByUser.get(row.user_id) ?? 0) + 1,
      );
    }

    // First pass — upsert allocations with attended_days. Default `included`
    // is true on creation iff the employee attended at least one day. After
    // creation the manager's toggle is sticky (we never overwrite it here).
    const existingAllocs = new Map(
      pool.allocations.map((a) => [a.user_id, a] as const),
    );
    for (const emp of employees) {
      const attended = attendedDaysByUser.get(emp.id) ?? 0;
      const existing = existingAllocs.get(emp.id);
      if (existing) {
        // Refresh only the derived attendance count — leave included /
        // override_amount / note alone.
        if (existing.attended_days !== attended) {
          await tx.tipAllocation.update({
            where: { id: existing.id },
            data: { attended_days: attended },
          });
        }
      } else {
        await tx.tipAllocation.create({
          data: {
            pool_id: poolId,
            user_id: emp.id,
            included: attended > 0,
            attended_days: attended,
            base_amount: new Decimal(0),
            final_amount: new Decimal(0),
          },
        });
      }
    }

    // Drop allocations for employees who are no longer eligible (deactivated
    // mid-week, payroll fields removed). Manager-overridden rows are kept so
    // the audit trail survives even if the employee's profile changes.
    const eligibleIds = new Set(employees.map((e) => e.id));
    for (const alloc of pool.allocations) {
      if (!eligibleIds.has(alloc.user_id) && alloc.override_amount == null) {
        await tx.tipAllocation.delete({ where: { id: alloc.id } });
      }
    }

    // Second pass — compute base_amount and final_amount.
    const allocsAfter = await tx.tipAllocation.findMany({
      where: { pool_id: poolId },
    });
    const includedCount = allocsAfter.filter((a) => a.included).length;
    const base = includedCount > 0
      ? totalCollected.div(includedCount).toDecimalPlaces(0, Decimal.ROUND_DOWN)
      : new Decimal(0);

    for (const alloc of allocsAfter) {
      const newBase = alloc.included ? base : new Decimal(0);
      const newFinal = alloc.override_amount != null
        ? new Decimal(alloc.override_amount)
        : newBase;
      if (
        !new Decimal(alloc.base_amount).equals(newBase) ||
        !new Decimal(alloc.final_amount).equals(newFinal)
      ) {
        await tx.tipAllocation.update({
          where: { id: alloc.id },
          data: { base_amount: newBase, final_amount: newFinal },
        });
      }
    }

    await tx.tipPool.update({
      where: { id: poolId },
      data: { total_collected: totalCollected },
    });

    return tx.tipPool.findUniqueOrThrow({
      where: { id: poolId },
      include: poolInclude,
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Allocation mutations (manager toggles)
// ────────────────────────────────────────────────────────────────────────────

export async function updateAllocation(
  poolId: string,
  userId: string,
  input: UpdateAllocationInput,
) {
  return prisma.$transaction(async (tx) => {
    const pool = await tx.tipPool.findUnique({
      where: { id: poolId },
      select: { id: true, status: true },
    });
    if (!pool) throw new NotFoundError('TipPool');
    if (pool.status !== TipPoolStatus.OPEN) {
      throw new ConflictError('Allocations can only be edited while the pool is OPEN');
    }
    const alloc = await tx.tipAllocation.findUnique({
      where: { pool_id_user_id: { pool_id: poolId, user_id: userId } },
    });
    if (!alloc) throw new NotFoundError('TipAllocation');

    const data: Prisma.TipAllocationUpdateInput = {};
    if (input.included !== undefined) data.included = input.included;
    if (input.override_amount !== undefined) {
      data.override_amount = input.override_amount === null
        ? null
        : new Decimal(input.override_amount);
    }
    if (input.note !== undefined) data.note = input.note;

    await tx.tipAllocation.update({
      where: { id: alloc.id },
      data,
    });
    return tx.tipPool.findUniqueOrThrow({
      where: { id: poolId },
      include: poolInclude,
    });
  }).then(() => refreshPool(poolId));
}

// ────────────────────────────────────────────────────────────────────────────
// Close — distribute as TIPS-sourced PayrollAdjustments
// ────────────────────────────────────────────────────────────────────────────

export async function closePool(poolId: string, closingUserId: string) {
  // Refresh once before opening the close tx so allocation totals reflect the
  // latest collected/included state, but the actual close is one atomic step.
  await refreshPool(poolId);

  return prisma.$transaction(async (tx) => {
    const pool = await tx.tipPool.findUnique({
      where: { id: poolId },
      include: { allocations: true },
    });
    if (!pool) throw new NotFoundError('TipPool');
    if (pool.status === TipPoolStatus.CLOSED) {
      throw new ConflictError('Pool is already closed');
    }

    // Verify each included allocation has a matching DRAFT PayrollPeriod
    // BEFORE we mutate anything — if even one is missing or approved, we
    // refuse the whole close so partial states never persist.
    const included = pool.allocations.filter(
      (a) => a.included && new Decimal(a.final_amount).gt(0),
    );

    const userIds = included.map((a) => a.user_id);
    const periods = await tx.payrollPeriod.findMany({
      where: {
        user_id: { in: userIds },
        week_start: pool.week_start,
      },
      select: { id: true, user_id: true, status: true },
    });
    const periodByUser = new Map(periods.map((p) => [p.user_id, p] as const));

    for (const alloc of included) {
      const period = periodByUser.get(alloc.user_id);
      if (!period) {
        const isoMon = pool.week_start.toISOString().slice(0, 10);
        throw new ConflictError(
          `Generate payroll first for week ${isoMon} before closing this pool`,
        );
      }
      if (period.status !== PayrollStatus.DRAFT) {
        throw new ConflictError(
          `Payroll for user ${alloc.user_id} is already ${period.status} — reopen it first`,
        );
      }
    }

    let totalDistributed = new Decimal(0);
    for (const alloc of included) {
      const period = periodByUser.get(alloc.user_id)!;
      const amount = new Decimal(alloc.final_amount);
      const isoMon = pool.week_start.toISOString().slice(0, 10);

      await tx.payrollPeriod.update({
        where: { id: period.id },
        data: { tips_amount: amount },
      });
      await tx.payrollAdjustment.create({
        data: {
          payroll_period_id: period.id,
          type: PayrollAdjustmentType.BONUS,
          label: `Tips week of ${isoMon}`,
          amount,
          source_kind: 'TIPS',
          source_id: alloc.id,
          created_by_user_id: closingUserId,
        },
      });
      await recalcPayroll(tx, period.id);
      totalDistributed = totalDistributed.add(amount);
    }

    return tx.tipPool.update({
      where: { id: poolId },
      data: {
        status: TipPoolStatus.CLOSED,
        total_distributed: totalDistributed,
        closed_at: new Date(),
        closed_by_user_id: closingUserId,
      },
      include: poolInclude,
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Reopen — reverse the TIPS adjustments and unlock the pool
// ────────────────────────────────────────────────────────────────────────────

export async function reopenPool(poolId: string) {
  return prisma.$transaction(async (tx) => {
    const pool = await tx.tipPool.findUnique({
      where: { id: poolId },
      include: { allocations: true },
    });
    if (!pool) throw new NotFoundError('TipPool');
    if (pool.status !== TipPoolStatus.CLOSED) {
      throw new ConflictError('Only CLOSED pools can be reopened');
    }

    // Find every TIPS adjustment whose source is one of this pool's
    // allocations. They MUST sit on payroll periods still in DRAFT — once a
    // payroll is APPROVED/PAID the tip line is part of an official paycheck
    // and we won't silently revoke it.
    const allocIds = pool.allocations.map((a) => a.id);
    const adjustments = await tx.payrollAdjustment.findMany({
      where: { source_kind: 'TIPS', source_id: { in: allocIds } },
      include: { period: { select: { id: true, status: true } } },
    });
    for (const adj of adjustments) {
      if (adj.period.status !== PayrollStatus.DRAFT) {
        throw new ConflictError(
          `Cannot reopen — payroll ${adj.period.id} is ${adj.period.status}; revert it to DRAFT first`,
        );
      }
    }

    // Reverse: zero tips_amount on each affected period, delete the TIPS
    // adjustments, recompute net.
    const periodIds = new Set(adjustments.map((a) => a.period.id));
    await tx.payrollAdjustment.deleteMany({
      where: { source_kind: 'TIPS', source_id: { in: allocIds } },
    });
    for (const periodId of periodIds) {
      await tx.payrollPeriod.update({
        where: { id: periodId },
        data: { tips_amount: new Decimal(0) },
      });
      await recalcPayroll(tx, periodId);
    }

    return tx.tipPool.update({
      where: { id: poolId },
      data: {
        status: TipPoolStatus.OPEN,
        total_distributed: new Decimal(0),
        closed_at: null,
        closed_by_user_id: null,
      },
      include: poolInclude,
    });
  }).then(() => refreshPool(poolId));
}

// Silence unused-import linter — re-export keeps tests/admin pages able to
// import the schema-derived enum value if they want to.
void BadRequestError;
