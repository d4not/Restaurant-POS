import type { BadgeTone } from '../../components/ui';
import type {
  CashMovementType,
  CashRegisterStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  TableStatus,
} from '../../types/operations';

export function orderStatusTone(status: OrderStatus): BadgeTone {
  switch (status) {
    case 'OPEN':      return 'gold';
    case 'PAID':      return 'green';
    case 'CANCELLED': return 'red';
  }
}

export function orderTypeTone(type: OrderType): BadgeTone {
  return type === 'DINE_IN' ? 'blue' : 'gray';
}

export function registerStatusTone(status: CashRegisterStatus): BadgeTone {
  return status === 'OPEN' ? 'green' : 'gray';
}

export function cashMovementTypeTone(type: CashMovementType): BadgeTone {
  return type === 'CASH_IN' ? 'green' : 'red';
}

export function paymentMethodTone(method: PaymentMethod): BadgeTone {
  switch (method) {
    case 'CASH':     return 'gold';
    case 'CARD':     return 'blue';
    case 'TRANSFER': return 'gray';
  }
}

// Table status badge palette: green = ready, red = busy, gold = host-reserved.
// (gold reads as the warm "yellow" the spec asked for in this design system.)
export function tableStatusTone(status: TableStatus): BadgeTone {
  switch (status) {
    case 'AVAILABLE': return 'green';
    case 'OCCUPIED':  return 'red';
    case 'RESERVED':  return 'gold';
  }
}

/**
 * Human-readable elapsed time. "2h 14m" / "37m" / "45s".
 * Caps out at "> 24h" for anything past a day.
 */
export function formatElapsed(from: string | Date, now = new Date()): string {
  const start = typeof from === 'string' ? new Date(from) : from;
  const diffMs = now.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '—';
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr >= 24) return `> ${Math.floor(hr / 24)}d`;
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m`;
  return `${sec}s`;
}
