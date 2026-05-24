import { api } from './client';
import type {
  ReplaceWeekInput,
  RosterRow,
  ScheduleSlot,
  UpsertDayInput,
  Week,
} from '../types/people';

export function listRoster() {
  return api.get<RosterRow[]>('/schedule');
}

export function getWeeklySchedule(userId: string) {
  return api.get<Week>(`/schedule/users/${userId}`);
}

export function replaceWeeklySchedule(userId: string, input: ReplaceWeekInput) {
  return api.put<Week>(`/schedule/users/${userId}`, input);
}

export function upsertScheduleDay(
  userId: string,
  dayOfWeek: number,
  input: UpsertDayInput,
) {
  return api.patch<ScheduleSlot>(
    `/schedule/users/${userId}/days/${dayOfWeek}`,
    input,
  );
}

export function clearScheduleDay(userId: string, dayOfWeek: number) {
  return api.delete<void>(`/schedule/users/${userId}/days/${dayOfWeek}`);
}
