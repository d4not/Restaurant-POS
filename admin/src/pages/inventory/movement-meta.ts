import type { BadgeTone } from '../../components/ui';
import type { StockMovementType } from '../../types/inventory';

/**
 * Color-code stock movement types: green = stock in, red = stock out,
 * gold = adjustments / manufacturing. Keeps the tables visually scannable.
 */
export function movementTypeTone(type: StockMovementType): BadgeTone {
  switch (type) {
    case 'PURCHASE':
    case 'TRANSFER_IN':
      return 'green';
    case 'SALE':
    case 'TRANSFER_OUT':
    case 'WRITE_OFF':
      return 'red';
    case 'ADJUSTMENT':
    case 'MANUFACTURE':
      return 'gold';
    default:
      return 'gray';
  }
}
