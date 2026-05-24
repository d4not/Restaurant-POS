import { z } from 'zod';

// day_of_week uses ISO numbering 0=Mon .. 6=Sun to match the project's other
// week-aware code (utils/week.ts and the existing PayrollPeriod week_start
// which is always a Monday).
export const dayOfWeekField = z.number().int().min(0).max(6);

// Times stored as minutes-since-midnight. 1440 (== 24*60) is the end-of-day
// upper bound; end must be > start so there's always at least one minute of
// scheduled work — empty/equal ranges go through the clearDay endpoint.
const minutesField = z.number().int().min(0).max(1440);

// Whole-week replace. Each entry includes its day_of_week; the service applies
// them atomically and clears any day not listed.
const weekSlotSchema = z
  .object({
    day_of_week: dayOfWeekField,
    start_minutes: minutesField,
    end_minutes: minutesField,
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.end_minutes > v.start_minutes, {
    message: 'end_minutes must be greater than start_minutes',
    path: ['end_minutes'],
  });

export const replaceWeekSchema = z
  .object({
    slots: z
      .array(weekSlotSchema)
      .max(7)
      .refine(
        (arr) => new Set(arr.map((s) => s.day_of_week)).size === arr.length,
        { message: 'duplicate day_of_week in slots' },
      ),
  })
  .strict();

// Single-day upsert. Body shape is the slot minus day_of_week (the day comes
// from the URL param to keep the resource semantics clean).
export const upsertDaySchema = z
  .object({
    start_minutes: minutesField,
    end_minutes: minutesField,
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.end_minutes > v.start_minutes, {
    message: 'end_minutes must be greater than start_minutes',
    path: ['end_minutes'],
  });

export const userIdParamSchema = z.object({ userId: z.string().uuid() });

export const userIdAndDayParamSchema = z.object({
  userId: z.string().uuid(),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
});

export type ReplaceWeekInput = z.infer<typeof replaceWeekSchema>;
export type UpsertDayInput = z.infer<typeof upsertDaySchema>;
