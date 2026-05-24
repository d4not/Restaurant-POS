/**
 * In-memory notifications store. Persisted across the lifetime of the
 * process, not across restarts — Track A explicitly defers the
 * `Notification` Prisma table until the schema.prisma is safe to edit.
 *
 * Once the table lands in Track B, this file is swapped for a Prisma-backed
 * implementation with the same surface. Service.ts and controllers don't
 * change.
 */

import { randomUUID } from 'node:crypto';
import type {
  NotificationEvent,
  NotificationEventType,
  NotificationSeverity,
} from '../event-types.js';

export interface StoredNotification {
  id: string;
  user_id: string;
  type: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  source_user_id: string | null;
  related_resource_type: string | null;
  related_resource_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface ListOptions {
  limit?: number;
  unreadOnly?: boolean;
}

class InMemoryStore {
  // user_id → list of notifications, newest-first.
  private byUser = new Map<string, StoredNotification[]>();

  push(userId: string, event: NotificationEvent): StoredNotification {
    const row: StoredNotification = {
      id: randomUUID(),
      user_id: userId,
      type: event.type,
      severity: event.severity,
      title: event.title,
      body: event.body,
      payload: event.payload ?? {},
      source_user_id: event.source_user_id ?? null,
      related_resource_type: event.related_resource?.type ?? null,
      related_resource_id: event.related_resource?.id ?? null,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    const list = this.byUser.get(userId) ?? [];
    list.unshift(row);
    // Cap per user to keep memory bounded — a Track B Prisma table can hold
    // unlimited rows, but in-memory we trim aggressively. 200 covers a heavy
    // operator's working day before the next swap-to-Prisma fix lands.
    if (list.length > 200) list.length = 200;
    this.byUser.set(userId, list);
    return row;
  }

  listForUser(userId: string, opts: ListOptions = {}): StoredNotification[] {
    const list = this.byUser.get(userId) ?? [];
    const limit = opts.limit ?? 20;
    const filtered = opts.unreadOnly ? list.filter((n) => n.read_at === null) : list;
    return filtered.slice(0, limit);
  }

  unreadCount(userId: string): number {
    const list = this.byUser.get(userId) ?? [];
    let count = 0;
    for (const n of list) if (n.read_at === null) count++;
    return count;
  }

  markRead(notifId: string, userId: string): StoredNotification | null {
    const list = this.byUser.get(userId);
    if (!list) return null;
    const row = list.find((n) => n.id === notifId);
    if (!row) return null;
    if (row.read_at === null) row.read_at = new Date().toISOString();
    return row;
  }

  /** Test helper — wipes everything. */
  clear(): void {
    this.byUser.clear();
  }
}

export const inMemoryStore = new InMemoryStore();
