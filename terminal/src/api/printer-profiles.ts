import { api } from './client';
import type { ComandaTemplate, ReceiptTemplate } from '../types/printer-templates';
import type { Printer } from './printers';

export interface PrinterProfileCategory {
  id: string;
  name: string;
  color: string | null;
  display_order: number;
}

export interface PrinterProfile {
  id: string;
  name: string;
  printer_id: string | null;
  printer: Printer | null;
  connection_type: 'NETWORK' | 'USB';
  address: string;
  paper_width: number;
  printer_model: string;
  character_set: string;
  prints_comandas: boolean;
  prints_receipts: boolean;
  comanda_template: ComandaTemplate | null;
  receipt_template: ReceiptTemplate | null;
  display_order: number;
  active: boolean;
  categories: PrinterProfileCategory[];
  created_at: string;
  updated_at: string;
}

export interface CreateProfileInput {
  name: string;
  printer_id?: string | null;
  connection_type?: 'NETWORK' | 'USB';
  address?: string;
  paper_width?: number;
  printer_model?: string;
  character_set?: string;
  prints_comandas?: boolean;
  prints_receipts?: boolean;
  comanda_template?: ComandaTemplate | null;
  receipt_template?: ReceiptTemplate | null;
  display_order?: number;
}

export type UpdateProfileInput = Partial<CreateProfileInput>;

export async function fetchProfiles(): Promise<PrinterProfile[]> {
  return api.get<PrinterProfile[]>('/printer-profiles');
}

export async function fetchProfile(id: string): Promise<PrinterProfile> {
  return api.get<PrinterProfile>(`/printer-profiles/${id}`);
}

export async function createProfile(input: CreateProfileInput): Promise<PrinterProfile> {
  return api.post<PrinterProfile>('/printer-profiles', input);
}

export async function updateProfile(id: string, input: UpdateProfileInput): Promise<PrinterProfile> {
  return api.patch<PrinterProfile>(`/printer-profiles/${id}`, input);
}

export async function deleteProfile(id: string): Promise<void> {
  await api.delete(`/printer-profiles/${id}`);
}

export async function assignCategories(profileId: string, categoryIds: string[]): Promise<PrinterProfile> {
  return api.put<PrinterProfile>(`/printer-profiles/${profileId}/categories`, { category_ids: categoryIds });
}

export async function testProfile(id: string): Promise<{ ok: boolean; error?: string; profile_name: string }> {
  return api.post(`/printer-profiles/${id}/test`);
}

export async function fetchRoutingMap(): Promise<Record<string, string>> {
  return api.get<Record<string, string>>('/printer-profiles/routing-map');
}

export async function fetchProfilesStatus(): Promise<Record<string, boolean>> {
  return api.get<Record<string, boolean>>('/printer-profiles/status');
}
