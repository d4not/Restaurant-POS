// Mobile printer adapter — backend-delegated. Both endpoints take only the
// order id and return ESC/POS print results; the kitchen printer is wired by
// the backend service, not the client. Bearer token is added by the shared
// terminal API client (../../terminal/src/api/client.ts), so we reuse it here.
import { api } from '@/api/client';
import type {
  PrintKitchenResult,
  PrintReceiptResult,
  PrinterStatusInfo,
} from '@/platform/types';

interface KitchenResponseBody {
  ok: boolean;
  error?: string;
  printed_count: number;
  is_correction: boolean;
  lines: string[];
}

interface ReceiptResponseBody {
  ok: boolean;
  error?: string;
  lines: string[];
}

export async function printKitchen(orderId: string): Promise<PrintKitchenResult> {
  const result = await api.post<KitchenResponseBody>('/print/kitchen', {
    order_id: orderId,
  });
  return {
    ok: result.ok,
    error: result.error,
    printed_count: result.printed_count,
    is_correction: result.is_correction,
  };
}

export async function printReceipt(orderId: string): Promise<PrintReceiptResult> {
  const result = await api.post<ReceiptResponseBody>('/print/receipt', {
    order_id: orderId,
  });
  return { ok: result.ok, error: result.error };
}

export async function printerStatus(): Promise<PrinterStatusInfo> {
  return api.get<PrinterStatusInfo>('/print/status');
}
