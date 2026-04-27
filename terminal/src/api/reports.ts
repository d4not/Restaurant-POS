import { api } from './client';

export type DailySummaryPaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';
export type CashMovementKind = 'CASH_IN' | 'CASH_OUT';

export interface DailySummaryOrders {
  count: number;
  gross_revenue: string;
  net_revenue: string;
  tax_total: string;
  discount_total: string;
  avg_ticket: string;
}

export interface DailySummaryPaymentMethodRow {
  method: DailySummaryPaymentMethod;
  count: number;
  total: string;
}

export interface DailySummaryCashMovementItem {
  id: string;
  type: CashMovementKind;
  amount: string;
  reason: string;
  created_at: string;
}

export interface DailySummaryCashMovements {
  cash_in_total: string;
  cash_out_total: string;
  items: DailySummaryCashMovementItem[];
}

export interface DailySummaryReport {
  date: string;
  register_id: string | null;
  orders: DailySummaryOrders;
  payment_methods: DailySummaryPaymentMethodRow[];
  cash_movements: DailySummaryCashMovements;
  expected_cash: string | null;
  generated_at: string;
}

export function getDailySummary(params: {
  date?: string;
  register_id?: string;
} = {}): Promise<DailySummaryReport> {
  const sp = new URLSearchParams();
  if (params.date) sp.set('date', params.date);
  if (params.register_id) sp.set('register_id', params.register_id);
  const qs = sp.toString();
  return api.get<DailySummaryReport>(`/reports/daily-summary${qs ? `?${qs}` : ''}`);
}
