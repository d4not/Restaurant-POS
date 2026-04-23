import { OrderStatus, TableStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * One zone in the terminal's floor view, with every active table flattened
 * into the response — including a summary of the table's currently-OPEN
 * orders so the renderer can colour the badge and show wait time without a
 * follow-up request.
 *
 * `current_order` is the OLDEST open order on the table (group ordering
 * common in cafés — the badge cares about how long the party has been seated,
 * not the most recent ticket). `open_order_count` lets the renderer say
 * "+2 more" when several tickets are stacked.
 */
export interface FloorTableSummary {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  open_order_count: number;
  current_order: {
    id: string;
    order_number: number;
    opened_at: Date;
    item_count: number;
    waiter: { id: string; name: string } | null;
    total: string;
  } | null;
}

export interface FloorZoneSummary {
  id: string;
  name: string;
  display_order: number;
  tables: FloorTableSummary[];
}

/**
 * Build the floor view: every active zone, ordered by display_order, with its
 * active tables and a per-table snapshot of the current OPEN order. One round
 * trip — the terminal polls this endpoint, so cheap reads matter.
 */
export async function getFloors(): Promise<FloorZoneSummary[]> {
  const zones = await prisma.zone.findMany({
    where: { active: true },
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    include: {
      tables: {
        where: { active: true },
        orderBy: { number: 'asc' },
        include: {
          orders: {
            where: { status: OrderStatus.OPEN },
            orderBy: { created_at: 'asc' },
            select: {
              id: true,
              order_number: true,
              created_at: true,
              total: true,
              user: { select: { id: true, name: true } },
              _count: { select: { items: true } },
            },
          },
        },
      },
    },
  });

  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    display_order: zone.display_order,
    tables: zone.tables.map((table) => {
      const openOrders = table.orders;
      const head = openOrders[0] ?? null;
      return {
        id: table.id,
        number: table.number,
        capacity: table.capacity,
        status: table.status,
        open_order_count: openOrders.length,
        current_order: head
          ? {
              id: head.id,
              order_number: head.order_number,
              opened_at: head.created_at,
              item_count: head._count.items,
              waiter: head.user,
              total: head.total.toString(),
            }
          : null,
      };
    }),
  }));
}
