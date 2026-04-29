import { api } from './client';

export interface PrinterStatus {
  kitchen: { configured: boolean; connected: boolean; ip: string; port: number };
  receipt: { configured: boolean; connected: boolean; ip: string; port: number };
  paper_width: number;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
  lines: string[];
}

export interface PrintKitchenResult extends PrintResult {
  printed_count: number;
  is_correction: boolean;
}

export function getPrinterStatus() {
  return api.get<PrinterStatus>('/print/status');
}

export function printKitchen(orderId: string) {
  return api.post<PrintKitchenResult>('/print/kitchen', { order_id: orderId });
}

export function printReceipt(orderId: string) {
  return api.post<PrintResult>('/print/receipt', { order_id: orderId });
}

/**
 * Fetch the bundled stylesheet for the corte-Z print template. The admin's
 * Report-template editor calls this on mount so an operator who has never
 * customised the template starts with the default CSS in the textarea
 * instead of an empty box.
 */
export function getDefaultReportTemplateCss() {
  return api.get<{ css: string }>('/print/report-template/default');
}
