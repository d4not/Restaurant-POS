import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { SETTING_KEYS } from '../../src/modules/settings/schema.js';
import { dispatch, listForUser, markRead } from '../../src/modules/notifications/service.js';
import { inMemoryStore } from '../../src/modules/notifications/providers/in-app.js';
import { notificationBus } from '../../src/modules/notifications/event-bus.js';
import { makeUser } from '../helpers/factories.js';

async function setEnabled(value: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.NOTIFICATIONS_ENABLED },
    create: { key: SETTING_KEYS.NOTIFICATIONS_ENABLED, value: String(value) },
    update: { value: String(value) },
  });
}

async function setQuietHours(start: string, end: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_START },
    create: { key: SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_START, value: start },
    update: { value: start },
  });
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_END },
    create: { key: SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_END, value: end },
    update: { value: end },
  });
}

beforeEach(() => {
  inMemoryStore.clear();
});

describe('notifications service — dispatch', () => {
  it('is a no-op when notifications are disabled', async () => {
    await setEnabled(false);
    const admin = await makeUser({ role: 'ADMIN' });

    const out = await dispatch({
      type: 'TEST',
      severity: 'INFO',
      title: 't',
      body: 'b',
      recipient_user_ids: [admin.id],
    });
    expect(out.delivered).toBe(0);
    expect(listForUser(admin.id).items).toHaveLength(0);
  });

  it('delivers to explicit recipient_user_ids', async () => {
    await setEnabled(true);
    await setQuietHours('00:00', '00:00'); // disable quiet
    const admin = await makeUser({ role: 'ADMIN' });

    const out = await dispatch({
      type: 'TEST',
      severity: 'INFO',
      title: 'Hi',
      body: 'There',
      recipient_user_ids: [admin.id],
    });
    expect(out.delivered).toBe(1);

    const list = listForUser(admin.id);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toBe('Hi');
    expect(list.items[0]?.read_at).toBeNull();
    expect(list.unread_count).toBe(1);
  });

  it('expands recipient_roles to active users with that role', async () => {
    await setEnabled(true);
    await setQuietHours('00:00', '00:00');
    const manager = await makeUser({ role: 'MANAGER' });
    const admin = await makeUser({ role: 'ADMIN' });
    // Inactive user with matching role should not receive.
    const inactive = await makeUser({ role: 'MANAGER' });
    await prisma.user.update({ where: { id: inactive.id }, data: { active: false } });
    // Waiter should not receive.
    const waiter = await makeUser({ role: 'WAITER' });

    const out = await dispatch({
      type: 'SHIFT_CLOSED',
      severity: 'INFO',
      title: 'Shift closed',
      body: '...',
      recipient_roles: ['MANAGER', 'ADMIN'],
    });
    expect(out.delivered).toBe(2);
    expect(listForUser(manager.id).items).toHaveLength(1);
    expect(listForUser(admin.id).items).toHaveLength(1);
    expect(listForUser(inactive.id).items).toHaveLength(0);
    expect(listForUser(waiter.id).items).toHaveLength(0);
  });

  it('does NOT deliver to source_user_id (no echo)', async () => {
    await setEnabled(true);
    await setQuietHours('00:00', '00:00');
    const manager = await makeUser({ role: 'MANAGER' });
    const admin = await makeUser({ role: 'ADMIN' });

    const out = await dispatch({
      type: 'MANAGER_HELP_REQUESTED',
      severity: 'WARNING',
      title: 'help',
      body: '...',
      recipient_roles: ['MANAGER', 'ADMIN'],
      source_user_id: manager.id,
    });
    expect(out.delivered).toBe(1); // admin only
    expect(listForUser(manager.id).items).toHaveLength(0);
    expect(listForUser(admin.id).items).toHaveLength(1);
  });

  it('dedupes when a user appears in both explicit IDs and roles', async () => {
    await setEnabled(true);
    await setQuietHours('00:00', '00:00');
    const admin = await makeUser({ role: 'ADMIN' });

    const out = await dispatch({
      type: 'TEST',
      severity: 'INFO',
      title: 't',
      body: 'b',
      recipient_user_ids: [admin.id],
      recipient_roles: ['ADMIN'],
    });
    expect(out.delivered).toBe(1);
    expect(listForUser(admin.id).items).toHaveLength(1);
  });

  it('suppresses non-critical events inside quiet hours', async () => {
    await setEnabled(true);
    // Force "now" inside the window — use the full 24h window 00:00→23:59 to
    // make the test deterministic regardless of when CI runs it.
    await setQuietHours('00:00', '23:59');
    const admin = await makeUser({ role: 'ADMIN' });

    const out = await dispatch({
      type: 'CASH_SHORTAGE_DETECTED',
      severity: 'WARNING',
      title: 'short',
      body: '...',
      recipient_user_ids: [admin.id],
    });
    expect(out.delivered).toBe(0);
  });

  it('CRITICAL severity bypasses quiet hours', async () => {
    await setEnabled(true);
    await setQuietHours('00:00', '23:59');
    const admin = await makeUser({ role: 'ADMIN' });

    const out = await dispatch({
      type: 'CASH_SHORTAGE_DETECTED',
      severity: 'CRITICAL',
      title: 'big short',
      body: '...',
      recipient_user_ids: [admin.id],
    });
    expect(out.delivered).toBe(1);
    expect(listForUser(admin.id).items[0]?.severity).toBe('CRITICAL');
  });

  it('markRead sets read_at and decrements unread_count', async () => {
    await setEnabled(true);
    await setQuietHours('00:00', '00:00');
    const admin = await makeUser({ role: 'ADMIN' });

    await dispatch({
      type: 'TEST',
      severity: 'INFO',
      title: 't',
      body: 'b',
      recipient_user_ids: [admin.id],
    });
    const before = listForUser(admin.id);
    expect(before.unread_count).toBe(1);
    const id = before.items[0]!.id;

    const updated = markRead(id, admin.id);
    expect(updated?.read_at).not.toBeNull();

    const after = listForUser(admin.id);
    expect(after.unread_count).toBe(0);
  });

  it('markRead returns null for an unknown id', () => {
    expect(markRead('00000000-0000-0000-0000-000000000000', 'someone')).toBeNull();
  });

  it('unreadOnly filter returns only unread items', async () => {
    await setEnabled(true);
    await setQuietHours('00:00', '00:00');
    const admin = await makeUser({ role: 'ADMIN' });

    await dispatch({
      type: 'TEST',
      severity: 'INFO',
      title: 'first',
      body: '.',
      recipient_user_ids: [admin.id],
    });
    await dispatch({
      type: 'TEST',
      severity: 'INFO',
      title: 'second',
      body: '.',
      recipient_user_ids: [admin.id],
    });
    const list = listForUser(admin.id);
    expect(list.items).toHaveLength(2);
    const firstId = list.items[1]!.id; // newest first → [second, first]
    markRead(firstId, admin.id);

    const unread = listForUser(admin.id, { unreadOnly: true });
    expect(unread.items).toHaveLength(1);
    expect(unread.items[0]?.title).toBe('second');
  });
});

describe('notifications bus → dispatch wiring', () => {
  it('emitting through the bus reaches the dispatch listener', async () => {
    await setEnabled(true);
    await setQuietHours('00:00', '00:00');
    const admin = await makeUser({ role: 'ADMIN' });

    notificationBus.emitEvent({
      type: 'TEST',
      severity: 'INFO',
      title: 'bus-driven',
      body: '...',
      recipient_user_ids: [admin.id],
    });

    // The listener calls dispatch synchronously (Promises only get scheduled
    // after the role-resolution awaits), so give the event loop one tick.
    await new Promise((r) => setTimeout(r, 30));

    const list = listForUser(admin.id);
    expect(list.items.some((n) => n.title === 'bus-driven')).toBe(true);
  });
});
