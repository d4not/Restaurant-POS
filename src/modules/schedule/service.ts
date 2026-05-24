import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import type { ReplaceWeekInput, UpsertDayInput } from './schema.js';

// Public shape returned by the read endpoints. Always a 7-element array
// indexed by day_of_week; null entries mean the employee is off that day.
export type WeekSlot = {
  id: string;
  day_of_week: number;
  start_minutes: number;
  end_minutes: number;
  active: boolean;
} | null;

export type Week = [WeekSlot, WeekSlot, WeekSlot, WeekSlot, WeekSlot, WeekSlot, WeekSlot];

function emptyWeek(): Week {
  return [null, null, null, null, null, null, null];
}

function rowToSlot(row: {
  id: string;
  day_of_week: number;
  start_minutes: number;
  end_minutes: number;
  active: boolean;
}): WeekSlot {
  return {
    id: row.id,
    day_of_week: row.day_of_week,
    start_minutes: row.start_minutes,
    end_minutes: row.end_minutes,
    active: row.active,
  };
}

async function ensureUserExists(userId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new NotFoundError('User');
}

export async function getWeeklySchedule(userId: string): Promise<Week> {
  await ensureUserExists(userId);
  const rows = await prisma.employeeScheduleSlot.findMany({
    where: { user_id: userId },
    orderBy: { day_of_week: 'asc' },
    select: {
      id: true,
      day_of_week: true,
      start_minutes: true,
      end_minutes: true,
      active: true,
    },
  });
  const week = emptyWeek();
  for (const row of rows) week[row.day_of_week] = rowToSlot(row);
  return week;
}

// Roster shape for the admin web's weekly grid: one row per active employee
// with a weekly_salary plus their 7-cell schedule. Sorted by name. Inactive
// users and non-payroll users are excluded — neither needs a schedule.
export interface RosterRow {
  user_id: string;
  user_name: string;
  position: string | null;
  role: string;
  week: Week;
}

export async function listRoster(): Promise<RosterRow[]> {
  const employees = await prisma.user.findMany({
    where: { active: true, weekly_salary: { not: null } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, position: true, role: true },
  });
  if (employees.length === 0) return [];
  const slots = await prisma.employeeScheduleSlot.findMany({
    where: { user_id: { in: employees.map((e) => e.id) } },
    select: {
      id: true,
      user_id: true,
      day_of_week: true,
      start_minutes: true,
      end_minutes: true,
      active: true,
    },
  });
  const byUser = new Map<string, Week>();
  for (const emp of employees) byUser.set(emp.id, emptyWeek());
  for (const s of slots) {
    const week = byUser.get(s.user_id);
    if (week) week[s.day_of_week] = rowToSlot(s);
  }
  return employees.map((e) => ({
    user_id: e.id,
    user_name: e.name,
    position: e.position,
    role: e.role,
    week: byUser.get(e.id) ?? emptyWeek(),
  }));
}

export async function replaceWeeklySchedule(
  userId: string,
  input: ReplaceWeekInput,
): Promise<Week> {
  return prisma.$transaction(async (tx) => {
    await ensureUserExists(userId, tx);
    // Atomic replace: wipe the user's slots and reinsert the provided set.
    // The single-block-per-day invariant is enforced by the unique index on
    // (user_id, day_of_week); the Zod schema also rejects duplicate days.
    await tx.employeeScheduleSlot.deleteMany({ where: { user_id: userId } });
    if (input.slots.length > 0) {
      await tx.employeeScheduleSlot.createMany({
        data: input.slots.map((s) => ({
          user_id: userId,
          day_of_week: s.day_of_week,
          start_minutes: s.start_minutes,
          end_minutes: s.end_minutes,
          active: s.active ?? true,
        })),
      });
    }
    const rows = await tx.employeeScheduleSlot.findMany({
      where: { user_id: userId },
      orderBy: { day_of_week: 'asc' },
      select: {
        id: true,
        day_of_week: true,
        start_minutes: true,
        end_minutes: true,
        active: true,
      },
    });
    const week = emptyWeek();
    for (const row of rows) week[row.day_of_week] = rowToSlot(row);
    return week;
  });
}

export async function upsertDay(
  userId: string,
  dayOfWeek: number,
  input: UpsertDayInput,
): Promise<WeekSlot> {
  await ensureUserExists(userId);
  const row = await prisma.employeeScheduleSlot.upsert({
    where: {
      user_id_day_of_week: { user_id: userId, day_of_week: dayOfWeek },
    },
    create: {
      user_id: userId,
      day_of_week: dayOfWeek,
      start_minutes: input.start_minutes,
      end_minutes: input.end_minutes,
      active: input.active ?? true,
    },
    update: {
      start_minutes: input.start_minutes,
      end_minutes: input.end_minutes,
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
    select: {
      id: true,
      day_of_week: true,
      start_minutes: true,
      end_minutes: true,
      active: true,
    },
  });
  return rowToSlot(row);
}

export async function clearDay(userId: string, dayOfWeek: number): Promise<void> {
  await ensureUserExists(userId);
  await prisma.employeeScheduleSlot.deleteMany({
    where: { user_id: userId, day_of_week: dayOfWeek },
  });
}

/**
 * Count of distinct active schedule days for a user. Used by payroll's
 * generatePayroll to derive `days_expected` instead of the hardcoded default.
 * Caller may pass a tx so the read sees the same snapshot as adjacent writes.
 */
export async function countActiveDays(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const client = tx ?? prisma;
  return client.employeeScheduleSlot.count({
    where: { user_id: userId, active: true },
  });
}
