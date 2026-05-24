// TanStack-Query wrappers for the admin product editor.
//
// Cache key conventions (kept in lockstep with ProductsListView):
//   ['admin', 'products', { includeInactive }]  — catalog list
//   ['admin', 'product', id]                    — single product
//   ['admin', 'productCategories']              — category dropdown
//
// Every mutation invalidates the broad `['admin', 'products']` prefix and the
// specific `['admin', 'product', id]` key so list rows and KPI strips stay in
// sync. No optimistic updates (the original draft didn't have any, and the
// network latency on a LAN is low enough not to need them).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachModifierGroup,
  bulkUpdateProducts,
  createProduct,
  createVariant,
  deleteProduct,
  deleteVariant,
  detachModifierGroup,
  duplicateProduct,
  getProduct,
  type CreateProductInput,
  type CreateVariantInput,
  type PosProduct,
  type ProductVariant,
  type ProductModifierGroupLink,
  type UpdateProductInput,
  type UpdateVariantInput,
  updateProduct,
  updateVariant,
} from '../api/products';
import {
  listProductCategories,
  type ProductCategory,
} from '../api/product-categories';
import { listTaxes, type Tax } from '../api/taxes';

/* ── Single product ───────────────────────────────────────── */

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'product', id],
    queryFn: () => getProduct(id as string),
    enabled: !!id,
    staleTime: 15_000,
  });
}

/* ── Mutations: product ───────────────────────────────────── */

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => createProduct(input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.setQueryData<PosProduct>(['admin', 'product', data.id], data);
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProductInput }) =>
      updateProduct(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.setQueryData<PosProduct>(['admin', 'product', data.id], data);
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', id] });
    },
  });
}

/* ── Mutations: variants ──────────────────────────────────── */

export function useCreateVariant(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVariantInput) => createVariant(productId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}

export function useUpdateVariant(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      variantId,
      input,
    }: {
      variantId: string;
      input: UpdateVariantInput;
    }): Promise<ProductVariant> => updateVariant(productId, variantId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}

export function useDeleteVariant(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) => deleteVariant(productId, variantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}

/* ── Mutations: modifier-group attach / detach ────────────── */

export function useAttachModifierGroup(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modifier_group_id: string): Promise<ProductModifierGroupLink> =>
      attachModifierGroup(productId, modifier_group_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}

export function useDetachModifierGroup(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => detachModifierGroup(productId, groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    },
  });
}

/* ── Duplicate + bulk ────────────────────────────────────── */

export function useDuplicateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => duplicateProduct(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.setQueryData<PosProduct>(['admin', 'product', data.id], data);
    },
  });
}

export function useBulkUpdateProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, update }: { ids: string[]; update: { active?: boolean } }) =>
      bulkUpdateProducts(ids, update),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });
}

/* ── Lookups (categories, taxes) ──────────────────────────── */

export function useProductCategories() {
  return useQuery<ProductCategory[]>({
    queryKey: ['admin', 'productCategories'],
    queryFn: listProductCategories,
    staleTime: 5 * 60_000,
  });
}

export function useTaxes(opts: { active?: boolean } = {}) {
  const key = opts.active === undefined ? 'all' : opts.active ? 'active' : 'inactive';
  return useQuery<Tax[]>({
    queryKey: ['admin', 'taxes', key],
    queryFn: () => listTaxes(opts),
    staleTime: 5 * 60_000,
  });
}
