import { DecorType, OrderStatus, TableShape, TableStatus, ZoneKind } from '@prisma/client';
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
 *
 * Layout fields (pos_x/pos_y/width/height/shape/rotation/label) drive the
 * visual-canvas floor plan: absolute-positioned table boxes with a saved
 * shape + rotation. Free-floating text annotations live in `labels`.
 */
export interface FloorTableSummary {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  shape: TableShape;
  label: string | null;
  rotation: number;
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

export interface FloorZoneLabelSummary {
  id: string;
  text: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  font_size: number;
  rotation: number;
}

export interface FloorDecorSummary {
  id: string;
  type: DecorType;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  label: string | null;
  rotation: number;
}

export interface FloorZoneSummary {
  id: string;
  name: string;
  display_order: number;
  // DINE_IN zones host positioned tables on the canvas. TAKEOUT zones never
  // do — the terminal renders a list of active takeout orders for that tab.
  kind: ZoneKind;
  // Floor-canvas geometry — the rendered dashed-bordered box.
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  tables: FloorTableSummary[];
  labels: FloorZoneLabelSummary[];
  decor: FloorDecorSummary[];
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
      zone_labels: {
        orderBy: { created_at: 'asc' },
      },
      floor_decor: {
        where: { active: true },
        orderBy: { created_at: 'asc' },
      },
    },
  });

  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    display_order: zone.display_order,
    kind: zone.kind,
    pos_x: zone.pos_x,
    pos_y: zone.pos_y,
    width: zone.width,
    height: zone.height,
    tables: zone.tables.map((table) => {
      const openOrders = table.orders;
      const head = openOrders[0] ?? null;
      return {
        id: table.id,
        number: table.number,
        capacity: table.capacity,
        status: table.status,
        pos_x: table.pos_x,
        pos_y: table.pos_y,
        width: table.width,
        height: table.height,
        shape: table.shape,
        label: table.label,
        rotation: table.rotation,
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
    labels: zone.zone_labels.map((label) => ({
      id: label.id,
      text: label.text,
      pos_x: label.pos_x,
      pos_y: label.pos_y,
      width: label.width,
      height: label.height,
      font_size: label.font_size,
      rotation: label.rotation,
    })),
    decor: zone.floor_decor.map((d) => ({
      id: d.id,
      type: d.type,
      pos_x: d.pos_x,
      pos_y: d.pos_y,
      width: d.width,
      height: d.height,
      label: d.label,
      rotation: d.rotation,
    })),
  }));
}
