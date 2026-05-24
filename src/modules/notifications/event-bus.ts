/**
 * Process-wide event bus for notifications. Any module that wants to fire a
 * notification calls `notificationBus.emit('event', data)`. The dispatch
 * service in this folder subscribes once and routes through the configured
 * providers.
 *
 * Why an EventEmitter and not a direct function call: decoupling. The
 * shifts / cash-registers refactor in flight should be able to add
 * `notificationBus.emit(...)` calls without taking a dependency on the
 * notifications module's implementation. The bus is the contract.
 */

import { EventEmitter } from 'node:events';
import type { NotificationEvent } from './event-types.js';

// Channel names align 1:1 with NotificationEventType values so callers can
// type-narrow at emit time. The dispatch listener fans every named channel
// into a single handler.
class NotificationBus extends EventEmitter {
  emitEvent(event: NotificationEvent): void {
    super.emit(event.type, event);
    super.emit('*', event);
  }
}

export const notificationBus = new NotificationBus();
// Generous cap — multiple providers + tests may add listeners. Default 10
// would print a memory-leak warning under benign conditions.
notificationBus.setMaxListeners(64);
