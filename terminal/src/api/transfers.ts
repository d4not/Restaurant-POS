import { api } from './client';

export interface TransferItemInput {
  supply_id: string;
  quantity: number;
}

export interface CreateTransferInput {
  from_storage_id: string;
  to_storage_id: string;
  date: string;
  notes?: string;
  items: TransferItemInput[];
}

export interface TransferResponse {
  id: string;
  from_storage_id: string;
  to_storage_id: string;
  date: string;
  notes: string | null;
  user_id: string;
  created_at: string;
  items: {
    id: string;
    supply_id: string;
    quantity: string;
  }[];
}

export function createTransfer(input: CreateTransferInput): Promise<TransferResponse> {
  return api.post<TransferResponse>('/transfers', input);
}
