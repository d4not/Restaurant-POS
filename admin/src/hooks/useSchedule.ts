import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  clearScheduleDay,
  getWeeklySchedule,
  listRoster,
  replaceWeeklySchedule,
  upsertScheduleDay,
} from '../api/schedule';
import type {
  ReplaceWeekInput,
  RosterRow,
  ScheduleSlot,
  UpsertDayInput,
  Week,
} from '../types/people';

export function useRoster() {
  return useQuery({
    queryKey: ['schedule'],
    queryFn: listRoster,
  });
}

export function useWeeklySchedule(userId: string | undefined) {
  return useQuery({
    queryKey: ['schedule', userId],
    queryFn: () => getWeeklySchedule(userId as string),
    enabled: !!userId,
  });
}

function invalidateSchedule(
  qc: ReturnType<typeof useQueryClient>,
  userId?: string,
) {
  qc.invalidateQueries({ queryKey: ['schedule'] });
  if (userId) qc.invalidateQueries({ queryKey: ['schedule', userId] });
  // Payroll's days_expected derives from the schedule, so any DRAFT row
  // could shift when the underlying schedule changes.
  qc.invalidateQueries({ queryKey: ['payroll'] });
}

export function useReplaceWeeklySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: ReplaceWeekInput }) =>
      replaceWeeklySchedule(userId, input),
    onSuccess: (_data, vars) => invalidateSchedule(qc, vars.userId),
  });
}

interface DayMutationVars {
  userId: string;
  dayOfWeek: number;
  input: UpsertDayInput;
}

interface DayMutationContext {
  rosterSnapshot?: RosterRow[];
  weekSnapshot?: Week;
}

function patchWeekForUser(week: Week | undefined, day: number, slot: ScheduleSlot | null): Week {
  const next: Week = week ? [...week] : Array(7).fill(null);
  // Always normalize to length 7 (just in case).
  while (next.length < 7) next.push(null);
  next[day] = slot;
  return next;
}

function tempSlot(day: number, input: UpsertDayInput): ScheduleSlot {
  return {
    id: `tmp_${crypto.randomUUID()}`,
    day_of_week: day,
    start_minutes: input.start_minutes,
    end_minutes: input.end_minutes,
    active: input.active ?? true,
  };
}

export function useUpsertScheduleDay() {
  const qc = useQueryClient();
  return useMutation<ScheduleSlot, Error, DayMutationVars, DayMutationContext>({
    mutationFn: ({ userId, dayOfWeek, input }) =>
      upsertScheduleDay(userId, dayOfWeek, input),
    onMutate: async ({ userId, dayOfWeek, input }) => {
      await qc.cancelQueries({ queryKey: ['schedule'] });
      await qc.cancelQueries({ queryKey: ['schedule', userId] });

      const weekSnapshot = qc.getQueryData<Week>(['schedule', userId]);
      const rosterSnapshot = qc.getQueryData<RosterRow[]>(['schedule']);

      // Optimistic single-user week cache
      qc.setQueryData<Week>(
        ['schedule', userId],
        patchWeekForUser(weekSnapshot, dayOfWeek, tempSlot(dayOfWeek, input)),
      );

      // Optimistic roster row
      if (rosterSnapshot) {
        qc.setQueryData<RosterRow[]>(
          ['schedule'],
          rosterSnapshot.map((row) =>
            row.user_id === userId
              ? { ...row, week: patchWeekForUser(row.week, dayOfWeek, tempSlot(dayOfWeek, input)) }
              : row,
          ),
        );
      }

      return { weekSnapshot, rosterSnapshot };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.weekSnapshot !== undefined) {
        qc.setQueryData(['schedule', vars.userId], ctx.weekSnapshot);
      }
      if (ctx.rosterSnapshot !== undefined) {
        qc.setQueryData(['schedule'], ctx.rosterSnapshot);
      }
    },
    onSettled: (_data, _err, vars) => {
      invalidateSchedule(qc, vars.userId);
    },
  });
}

interface ClearMutationVars {
  userId: string;
  dayOfWeek: number;
}

export function useClearScheduleDay() {
  const qc = useQueryClient();
  return useMutation<void, Error, ClearMutationVars, DayMutationContext>({
    mutationFn: ({ userId, dayOfWeek }) => clearScheduleDay(userId, dayOfWeek),
    onMutate: async ({ userId, dayOfWeek }) => {
      await qc.cancelQueries({ queryKey: ['schedule'] });
      await qc.cancelQueries({ queryKey: ['schedule', userId] });

      const weekSnapshot = qc.getQueryData<Week>(['schedule', userId]);
      const rosterSnapshot = qc.getQueryData<RosterRow[]>(['schedule']);

      qc.setQueryData<Week>(
        ['schedule', userId],
        patchWeekForUser(weekSnapshot, dayOfWeek, null),
      );
      if (rosterSnapshot) {
        qc.setQueryData<RosterRow[]>(
          ['schedule'],
          rosterSnapshot.map((row) =>
            row.user_id === userId
              ? { ...row, week: patchWeekForUser(row.week, dayOfWeek, null) }
              : row,
          ),
        );
      }
      return { weekSnapshot, rosterSnapshot };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.weekSnapshot !== undefined) {
        qc.setQueryData(['schedule', vars.userId], ctx.weekSnapshot);
      }
      if (ctx.rosterSnapshot !== undefined) {
        qc.setQueryData(['schedule'], ctx.rosterSnapshot);
      }
    },
    onSettled: (_data, _err, vars) => {
      invalidateSchedule(qc, vars.userId);
    },
  });
}
