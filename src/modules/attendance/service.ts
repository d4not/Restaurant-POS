import { AttendanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateAttendanceInput,
  ListAttendanceQuery,
  UpdateAttendanceInput,
} from './schema.js';

/**
 * Normalize to midnight UTC so the @@unique([user_id, date]) constraint
 * collapses any time-of-day on the incoming Date to the calendar day.
 */
function normalizeDate(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const attendanceInclude = {
  user: { select: { id: true, name: true } },
} satisfies Prisma.AttendanceInclude;

/**
 * Upsert on (user_id, date). Re-logging the same day overwrites the existing
 * record instead of raising a duplicate-key error — matches how the admin UI
 * wants to edit "yesterday was a sick day, not present after all".
 */
export async function logAttendance(recordedBy: string, input: CreateAttendanceInput) {
  const date = normalizeDate(input.date);
  if (date.getTime() > todayUtc().getTime()) {
    throw new BadRequestError('date cannot be in the future');
  }

  const employee = await prisma.user.findUnique({
    where: { id: input.user_id },
    select: { id: true, active: true },
  });
  if (!employee) throw new BadRequestError('employee not found');
  if (!employee.active) throw new BadRequestError('employee is inactive');

  // ABSENT rows default to is_paid=true but callers can flag unpaid absences;
  // non-ABSENT rows always store is_paid=true so payroll queries can filter
  // on (status=ABSENT, is_paid=false) without NULL ambiguity.
  const isPaid =
    input.status === AttendanceStatus.ABSENT ? (input.is_paid ?? true) : true;

  return prisma.attendance.upsert({
    where: { user_id_date: { user_id: input.user_id, date } },
    create: {
      user_id: input.user_id,
      date,
      status: input.status,
      reason: input.reason,
      is_paid: isPaid,
      notes: input.notes,
      recorded_by: recordedBy,
    },
    update: {
      status: input.status,
      reason: input.reason,
      is_paid: isPaid,
      notes: input.notes,
      recorded_by: recordedBy,
    },
    include: attendanceInclude,
  });
}

export async function listAttendance(query: ListAttendanceQuery) {
  const where: Prisma.AttendanceWhereInput = {
    ...(query.user_id ? { user_id: query.user_id } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: normalizeDate(query.from) } : {}),
            ...(query.to ? { lte: normalizeDate(query.to) } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.attendance.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    include: attendanceInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function updateAttendance(id: string, input: UpdateAttendanceInput) {
  const existing = await prisma.attendance.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Attendance');

  const nextStatus = input.status ?? existing.status;
  // Keep the invariant: only ABSENT rows can carry is_paid=false.
  const nextIsPaid =
    nextStatus === AttendanceStatus.ABSENT
      ? (input.is_paid ?? existing.is_paid)
      : true;

  return prisma.attendance.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      is_paid: nextIsPaid,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: attendanceInclude,
  });
}

export async function deleteAttendance(id: string) {
  const existing = await prisma.attendance.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Attendance');
  await prisma.attendance.delete({ where: { id } });
}
