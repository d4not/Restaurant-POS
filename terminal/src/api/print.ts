import { api } from './client';

export interface PrinterRoleStatus {
  configured: boolean;
  connected: boolean;
  ip: string;
  port: number;
}

export interface PrinterStatus {
  kitchen: PrinterRoleStatus;
  receipt: PrinterRoleStatus;
  paper_width: number;
}

export function getPrinterStatus(): Promise<PrinterStatus> {
  return api.get<PrinterStatus>('/print/status');
}
