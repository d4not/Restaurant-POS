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

export type PrinterDiagnosticCode =
  | 'OK'
  | 'NOT_CONFIGURED'
  | 'INVALID_PORT'
  | 'UNREACHABLE'
  | 'OTHER_HOST_BUT_OFF';

export interface PrinterDiagnosticEntry extends PrinterRoleStatus {
  code: PrinterDiagnosticCode;
  message: string;
  remedies: string[];
}

export interface PrinterDiagnostics {
  kitchen: PrinterDiagnosticEntry;
  receipt: PrinterDiagnosticEntry;
  paper_width: number;
  scanned_at: string;
}

export interface DiscoveredPrinter {
  ip: string;
  port: number;
  hostname: string | null;
  latency_ms: number;
}

export interface ScanResult {
  subnet: string | null;
  port: number;
  scanned: number;
  printers: DiscoveredPrinter[];
}

export function getPrinterStatus(): Promise<PrinterStatus> {
  return api.get<PrinterStatus>('/print/status');
}

export function getPrinterDiagnostics(): Promise<PrinterDiagnostics> {
  return api.get<PrinterDiagnostics>('/print/diagnose');
}

export interface ScanPrintersInput {
  subnet?: string;
  port?: number;
  timeout_ms?: number;
}

export function scanPrinters(input: ScanPrintersInput = {}): Promise<ScanResult> {
  return api.post<ScanResult>('/print/scan', input);
}

export function testPrint(role: 'kitchen' | 'receipt'): Promise<{ ok: boolean; error?: string }> {
  return api.post<{ ok: boolean; error?: string }>('/print/test', { role });
}
