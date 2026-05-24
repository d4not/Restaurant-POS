import { api } from './client';
import type { PageResult } from './pagination';

export interface EmployeeProductLinkedProduct {
  id: string;
  name: string;
  type: 'PRODUCT' | 'DISH';
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
  // Decimal serialized as string (centavos). UI converts at the boundary.
  employee_price: string;
  label: string | null;
  active: boolean;
  display_order: number;
  product: EmployeeProductLinkedProduct;
  variant: EmployeeProductLinkedVariant | null;
}

// Drain the active catalogue. Most cafés will have <20 perk products — one
// page is enough — but pagination is wired in case the list grows.
export async function fetchActiveEmployeeProducts(): Promise<EmployeeProduct[]> {
  const out: EmployeeProduct[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page: PageResult<EmployeeProduct> = await api.get<PageResult<EmployeeProduct>>(
      `/employee-products?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export interface CreateEmployeeSaleInput {
  employee_product_id: string;
  employee_user_id: string;
  quantity?: number;
  notes?: string;
}

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
  product: { id: string; name: string };
  variant: { id: string; name: string } | null;
  employee: { id: string; name: string; role: string };
  recorded_by: { id: string; name: string; role: string };
}

export function createEmployeeSale(input: CreateEmployeeSaleInput): Promise<EmployeeSale> {
  return api.post<EmployeeSale>('/employee-sales', input);
}

export function listEmployeeSales(
  params: { limit?: number } = {},
): Promise<PageResult<EmployeeSale>> {
  const sp = new URLSearchParams();
  sp.set('limit', String(params.limit ?? 20));
  return api.get<PageResult<EmployeeSale>>(`/employee-sales?${sp.toString()}`);
}
