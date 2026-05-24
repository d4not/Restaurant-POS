// Weekly roster API client. Mirrors admin/src/api/schedule.ts.
//
// The terminal only consumes the read-only `GET /schedule` endpoint for the
// in-mode Schedule view. Edits land in the admin web.

import { api } from './client';
import type { UserRole } from './employees';

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

export function listRoster(): Promise<RosterRow[]> {
  return api.get<RosterRow[]>('/schedule');
}
