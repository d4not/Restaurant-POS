import { api } from './client';
import type {
  ActiveOrder,
  FloorTable,
  FloorZone,
  FloorZoneLabel,
  TableShape,
} from '../types/api';

export function getFloors(): Promise<FloorZone[]> {
  return api.get<FloorZone[]>('/floors');
}

export function getActiveOrders(): Promise<ActiveOrder[]> {
  return api.get<ActiveOrder[]>('/orders/active');
}

// ── Floor-plan editor ───────────────────────────────────────────────────

export interface TableLayoutPatch {
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  shape?: TableShape;
  label?: string | null;
  rotation?: number;
  capacity?: number;
  number?: number;
}

export function patchTable(id: string, patch: TableLayoutPatch): Promise<FloorTable> {
  return api.patch<FloorTable>(`/tables/${id}`, patch);
}

export interface CreateTableInput {
  zone_id: string;
  number: number;
  capacity?: number;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  shape?: TableShape;
  label?: string | null;
  rotation?: number;
}

export function createTable(input: CreateTableInput): Promise<FloorTable> {
  return api.post<FloorTable>('/tables', input);
}

export function deleteTable(id: string): Promise<void> {
  return api.delete<void>(`/tables/${id}`);
}

// ── Zone labels ─────────────────────────────────────────────────────────

export interface CreateZoneLabelInput {
  zone_id: string;
  text: string;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  font_size?: number;
  rotation?: number;
}

export function createZoneLabel(input: CreateZoneLabelInput): Promise<FloorZoneLabel> {
  return api.post<FloorZoneLabel>('/zone-labels', input);
}

export interface ZoneLabelPatch {
  text?: string;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  font_size?: number;
  rotation?: number;
}

export function patchZoneLabel(id: string, patch: ZoneLabelPatch): Promise<FloorZoneLabel> {
  return api.patch<FloorZoneLabel>(`/zone-labels/${id}`, patch);
}

export function deleteZoneLabel(id: string): Promise<void> {
  return api.delete<void>(`/zone-labels/${id}`);
}
