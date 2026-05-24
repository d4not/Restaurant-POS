import { api } from './client';
import type { Paginated } from '../types/api';

/* ── Types mirroring the backend include shape ─────────────────────────── */

export interface EmployeeProductLinkedProduct {
  id: string;
  name: string;
  type: 'PRODUCT' | 'DISH' | 'PREPARATION';
  image_url: string | null;
  icon_color: string | null;
}

export interface EmployeeProductLinkedVariant {
  id: string;
  name: string;
  sell_price: string;
}

export interface EmployeeProduct {
  id: string;
  product_id: string;
  variant_id: string | null;
  // Centavos serialized as Decimal (string). UI converts to/from major units.
  employee_price: string;
  label: string | null;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  product: EmployeeProductLinkedProduct;
  variant: EmployeeProductLinkedVariant | null;
}

export interface CreateEmployeeProductInput {
  product_id: string;
  variant_id?: string | null;
  employee_price: number;
  label?: string | null;
  active?: boolean;
  display_order?: number;
}

export interface UpdateEmployeeProductInput {
  employee_price?: number;
  label?: string | null;
  active?: boolean;
  display_order?: number;
}

export interface ListEmployeeProductsParams {
  cursor?: string;
  limit?: number;
  active?: boolean;
  product_id?: string;
}

/* ── EmployeeProduct ────────────────────────────────────────────────────── */

export function listEmployeeProducts(params: ListEmployeeProductsParams = {}) {
  const query: Record<string, string | number | undefined> = {
    cursor: params.cursor,
    limit: params.limit,
    product_id: params.product_id,
  };
  if (params.active !== undefined) query.active = params.active ? 'true' : 'false';
  return api.get<Paginated<EmployeeProduct>>('/employee-products', query);
}

export function getEmployeeProduct(id: string) {
  return api.get<EmployeeProduct>(`/employee-products/${id}`);
}

export function createEmployeeProduct(input: CreateEmployeeProductInput) {
  return api.post<EmployeeProduct>('/employee-products', input);
}

export function updateEmployeeProduct(id: string, input: UpdateEmployeeProductInput) {
  return api.patch<EmployeeProduct>(`/employee-products/${id}`, input);
}

export function deleteEmployeeProduct(id: string) {
  return api.delete<EmployeeProduct | null>(`/employee-products/${id}`);
}

/* ── EmployeeSale (audit history) ──────────────────────────────────────── */

export interface EmployeeSale {
  id: string;
  employee_product_id: string;
  product_id: string;
  variant_id: string | null;
  employee_user_id: string;
  recorded_by_user_id: string;
  register_id: string | null;
  product_name: string;
  unit_price: string;
  quantity: number;
  total: string;
  notes: string | null;
  date: string;
  created_at: string;
  employee_product: { id: string; label: string | null };
  product: { id: string; name: string };
  variant: { id: string; name: string } | null;
  employee: { id: string; name: string; role: string };
  recorded_by: { id: string; name: string; role: string };
}

export interface ListEmployeeSalesParams {
  cursor?: string;
  limit?: number;
  employee_user_id?: string;
  product_id?: string;
  register_id?: string;
  from?: string;
  to?: string;
}

export function listEmployeeSales(params: ListEmployeeSalesParams = {}) {
  return api.get<Paginated<EmployeeSale>>('/employee-sales', { ...params });
}
