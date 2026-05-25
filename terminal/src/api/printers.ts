import { api } from './client';

export interface Printer {
  id: string;
  name: string;
  connection_type: 'NETWORK' | 'USB';
  address: string;
  paper_width: number;
  printer_model: string;
  character_set: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePrinterInput {
  name: string;
  connection_type?: 'NETWORK' | 'USB';
  address?: string;
  paper_width?: number;
  printer_model?: string;
  character_set?: string;
}

export type UpdatePrinterInput = Partial<CreatePrinterInput>;

export async function fetchPrinters(): Promise<Printer[]> {
  return api.get<Printer[]>('/printers');
}

export async function fetchPrinter(id: string): Promise<Printer> {
  return api.get<Printer>(`/printers/${id}`);
}

export async function createPrinter(input: CreatePrinterInput): Promise<Printer> {
  return api.post<Printer>('/printers', input);
}

export async function updatePrinter(id: string, input: UpdatePrinterInput): Promise<Printer> {
  return api.patch<Printer>(`/printers/${id}`, input);
}

export async function deletePrinter(id: string): Promise<void> {
  await api.delete(`/printers/${id}`);
}

export async function fetchPrintersStatus(): Promise<Record<string, boolean>> {
  return api.get<Record<string, boolean>>('/printers/status');
}
