import { api } from './client';

export type TableStatusValue = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';
export type TableShapeValue = 'TABLE_RECT' | 'TABLE_CIRCLE';
export type ZoneKindValue = 'DINE_IN' | 'TAKEOUT';
export type DecorTypeValue = 'BAR_COUNTER' | 'DECOR_PLANT';

export interface FloorTable {
  id: string;
  number: number;
  capacity: number;
  status: TableStatusValue;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  shape: TableShapeValue;
  label: string | null;
  rotation: number;
  open_order_count: number;
  current_order: {
    id: string;
    order_number: number;
    opened_at: string;
    item_count: number;
    waiter: { id: string; name: string } | null;
    total: string;
  } | null;
}

export interface FloorZoneLabel {
  id: string;
  text: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  font_size: number;
  rotation: number;
}

export interface FloorDecor {
  id: string;
  type: DecorTypeValue;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  label: string | null;
  rotation: number;
}

export interface FloorZone {
  id: string;
  name: string;
  display_order: number;
  kind: ZoneKindValue;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  tables: FloorTable[];
  labels: FloorZoneLabel[];
  decor: FloorDecor[];
}

export function fetchFloors(): Promise<FloorZone[]> {
  return api.get<FloorZone[]>('/floors');
}
