import { api } from './client';

/* ── Product costs ───────────────────────────────────────── */

export interface ProductCostVariantRow {
  variant_id: string;
  variant_name: string;
  sell_price: string;
  recipe_cost: string;
  food_cost_pct: string;
  gross_margin: string;
  active: boolean;
}

export interface ProductCostRow {
  product_id: string;
  product_name: string;
  type: 'PRODUCT' | 'DISH';
  category_id: string | null;
  category_name: string | null;
  sell_price: string | null;
  recipe_cost: string;
  food_cost_pct: string;
  markup: string;
  gross_margin: string | null;
  active: boolean;
  variants: ProductCostVariantRow[];
}

export interface ProductCostReport {
  generated_at: string;
  rows: ProductCostRow[];
}

export function getProductCosts(params: { active_only?: boolean } = {}) {
  return api.get<ProductCostReport>('/reports/product-costs', { ...params });
}

/* ── Variance ────────────────────────────────────────────── */

export interface VarianceRow {
  supply_id: string;
  supply_name: string;
  storage_id: string;
  storage_name: string;
  base_unit: string;
  beginning: string;
  purchases: string;
  ending: string;
  actual_usage: string;
  theoretical_usage: string;
  variance: string;
  variance_cost: string;
  average_cost: string;
}

export interface VarianceReport {
  from: string;
  to: string;
  storage_id: string | null;
  rows: VarianceRow[];
}

export function getVariance(params: {
  from: string;
  to: string;
  storage_id?: string;
}) {
  return api.get<VarianceReport>('/reports/variance', { ...params });
}

/* ── Supply movements ─────────────────────────────────────── */

export interface SupplyMovementSummary {
  purchases_in: string;
  sales_out: string;
  transfers_in: string;
  transfers_out: string;
  write_offs_out: string;
  adjustments_net: string;
  manufacture_in: string;
  net_change: string;
}

export interface SupplyMovementRow {
  id: string;
  created_at: string;
  storage_id: string;
  storage_name: string;
  type: string;
  quantity: string;
  unit_cost: string;
  reference_type: string;
  reference_id: string;
}

export interface SupplyMovementReport {
  supply_id: string;
  supply_name: string;
  base_unit: string;
  from: string;
  to: string;
  storage_id: string | null;
  summary: SupplyMovementSummary;
  movements: SupplyMovementRow[];
}

export function getSupplyMovementsReport(params: {
  supply_id: string;
  storage_id?: string;
  from: string;
  to: string;
}) {
  return api.get<SupplyMovementReport>('/reports/supply-movements', { ...params });
}

/* ── Product analysis ────────────────────────────────────── */

export interface ProductAnalysisVariantRow {
  variant_id: string | null;
  variant_name: string;
  orders_count: number;
  total_revenue: string;
}

export interface ProductAnalysisModifierRow {
  modifier_id: string;
  modifier_name: string;
  times_used: number;
  extra_revenue: string;
}

export interface ProductAnalysisIngredientRow {
  supply_id: string;
  supply_name: string;
  total_quantity: string;
  unit: string;
  total_cost: string;
}

export interface ProductAnalysisReport {
  product_id: string;
  product_name: string;
  from: string;
  to: string;
  variant_sales: ProductAnalysisVariantRow[];
  modifier_usage: ProductAnalysisModifierRow[];
  ingredients_used: ProductAnalysisIngredientRow[];
}

export function getProductAnalysis(params: {
  product_id: string;
  from: string;
  to: string;
}) {
  return api.get<ProductAnalysisReport>('/reports/product-analysis', { ...params });
}

/* ── Products sold (Poster-style breakdown) ──────────────────── */

export interface ProductsSoldRow {
  key: string;
  product_id: string;
  product_name: string;
  category_id: string | null;
  category_name: string | null;
  variant_id: string | null;
  variant_name: string | null;
  modifier_signature: string;
  quantity: number;
  gross_sales: string;
  discount: string;
  revenue: string;
  cost: string;
  profit: string;
}

export interface ProductsSoldTotals {
  quantity: number;
  gross_sales: string;
  discount: string;
  revenue: string;
  cost: string;
  profit: string;
}

export interface ProductsSoldReport {
  from: string;
  to: string;
  filters: {
    category_id: string | null;
    user_id: string | null;
    q: string | null;
  };
  totals: ProductsSoldTotals;
  rows: ProductsSoldRow[];
}

export function getProductsSold(params: {
  from: string;
  to: string;
  category_id?: string;
  user_id?: string;
  q?: string;
}) {
  return api.get<ProductsSoldReport>('/reports/products-sold', { ...params });
}
