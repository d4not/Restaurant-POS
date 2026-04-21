import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  attachModifierGroup,
  createProduct,
  createVariant,
  deleteProduct,
  deleteVariant,
  detachModifierGroup,
  getProduct,
  listProductModifierGroups,
  listProducts,
  listVariants,
  updateProduct,
  updateVariant,
  type ListProductsParams,
} from '../api/products';

const LIMIT = 50;

export function useProducts(filters: Omit<ListProductsParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['products', filters],
    queryFn: ({ pageParam }) =>
      listProducts({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id as string),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateProduct>[1] }) =>
      updateProduct(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', data.id] });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

/* ── Variants ───────────────────────────────────────────── */

export function useVariants(productId: string | undefined) {
  return useQuery({
    queryKey: ['product', productId, 'variants'],
    queryFn: () => listVariants(productId as string),
    enabled: !!productId,
  });
}

export function useCreateVariant(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createVariant>[1]) =>
      createVariant(productId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] });
      qc.invalidateQueries({ queryKey: ['product', productId, 'variants'] });
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
      input: Parameters<typeof updateVariant>[2];
    }) => updateVariant(productId, variantId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] });
      qc.invalidateQueries({ queryKey: ['product', productId, 'variants'] });
    },
  });
}

export function useDeleteVariant(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) => deleteVariant(productId, variantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] });
      qc.invalidateQueries({ queryKey: ['product', productId, 'variants'] });
    },
  });
}

/* ── Attached modifier groups ───────────────────────────── */

export function useProductModifierGroups(productId: string | undefined) {
  return useQuery({
    queryKey: ['product', productId, 'modifier-groups'],
    queryFn: () => listProductModifierGroups(productId as string),
    enabled: !!productId,
  });
}

export function useAttachModifierGroup(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modifier_group_id: string) =>
      attachModifierGroup(productId, modifier_group_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] });
      qc.invalidateQueries({ queryKey: ['product', productId, 'modifier-groups'] });
    },
  });
}

export function useDetachModifierGroup(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => detachModifierGroup(productId, groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] });
      qc.invalidateQueries({ queryKey: ['product', productId, 'modifier-groups'] });
    },
  });
}
