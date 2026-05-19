import {
  keepPreviousData,
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
import type { Paginated } from '../types/api';
import type {
  ModifierGroup,
  ModifierGroupLink,
  Product,
  ProductVariant,
} from '../types/menu';

const LIMIT = 50;

type ProductsInfData = {
  pages: Array<Paginated<Product>>;
  pageParams: unknown[];
};

export function useProducts(filters: Omit<ListProductsParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['products', filters],
    queryFn: ({ pageParam }) =>
      listProducts({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
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
    onMutate: async (input: Parameters<typeof createProduct>[0]) => {
      await qc.cancelQueries({ queryKey: ['products'] });
      const tempId = `tmp_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const optimistic: Product = {
        id: tempId,
        name: input.name,
        type: input.type,
        category_id: input.category_id ?? null,
        station_id: input.station_id ?? null,
        sell_price: input.sell_price != null ? String(input.sell_price) : null,
        recipe_cost: '0',
        food_cost_pct: '0',
        markup: '0',
        image_url: input.image_url ?? null,
        icon_color: input.icon_color ?? null,
        display_order: input.display_order ?? 0,
        active: input.active ?? true,
        allow_discount: input.allow_discount ?? true,
        sold_by_weight: input.sold_by_weight ?? false,
        barcode: input.barcode ?? null,
        tax_id: input.tax_id ?? null,
        supply_id: input.supply_id ?? null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        variants: [],
        modifier_groups: [],
      };
      const snapshot = qc.getQueriesData<ProductsInfData>({ queryKey: ['products'] });
      for (const [key, data] of snapshot) {
        if (!data || data.pages.length === 0) continue;
        const [first, ...rest] = data.pages;
        qc.setQueryData<ProductsInfData>(key, {
          ...data,
          pages: [{ ...first, items: [optimistic, ...first.items] }, ...rest],
        });
      }
      return { tempId, snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
    },
    onSuccess: (server, _vars, ctx) => {
      if (!ctx) return;
      const entries = qc.getQueriesData<ProductsInfData>({ queryKey: ['products'] });
      for (const [key, data] of entries) {
        if (!data) continue;
        qc.setQueryData<ProductsInfData>(key, {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((it) => (it.id === ctx.tempId ? server : it)),
          })),
        });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
    },
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
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['product', productId] });
      const tempId = `tmp_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const optimistic: ProductVariant = {
        id: tempId,
        product_id: productId,
        name: input.name,
        sell_price: String(input.sell_price ?? 0),
        barcode: input.barcode ?? null,
        recipe_cost: '0',
        food_cost_pct: '0',
        display_order: input.display_order ?? 0,
        active: input.active ?? true,
        created_at: now,
        updated_at: now,
      };
      const prevVariants = qc.getQueryData<ProductVariant[]>([
        'product',
        productId,
        'variants',
      ]);
      const prevDetail = qc.getQueryData<Product>(['product', productId]);
      qc.setQueryData<ProductVariant[]>(
        ['product', productId, 'variants'],
        (old) => [...(old ?? []), optimistic],
      );
      qc.setQueryData<Product>(['product', productId], (old) =>
        old
          ? { ...old, variants: [...(old.variants ?? []), optimistic] }
          : old,
      );
      return { tempId, prevVariants, prevDetail };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      qc.setQueryData(['product', productId, 'variants'], ctx.prevVariants);
      qc.setQueryData(['product', productId], ctx.prevDetail);
    },
    onSuccess: (server, _v, ctx) => {
      if (!ctx) return;
      qc.setQueryData<ProductVariant[]>(
        ['product', productId, 'variants'],
        (old) => old?.map((v) => (v.id === ctx.tempId ? server : v)),
      );
      qc.setQueryData<Product>(['product', productId], (old) =>
        old
          ? {
              ...old,
              variants: old.variants?.map((v) =>
                v.id === ctx.tempId ? server : v,
              ),
            }
          : old,
      );
    },
    onSettled: () => {
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

// Look up a ModifierGroup from any cached useQuery (paginated) so the
// attachment row can render the group name straight away. Modifier groups use a
// flat useQuery, so the cache is `Paginated<ModifierGroup>`, not infinite.
function lookupGroupForAttach(
  qc: ReturnType<typeof useQueryClient>,
  groupId: string,
): ModifierGroup | null {
  const single = qc.getQueryData<ModifierGroup>(['modifier-group', groupId]);
  if (single) return single;
  const lists = qc.getQueriesData<Paginated<ModifierGroup>>({
    queryKey: ['modifier-groups'],
  });
  for (const [, data] of lists) {
    if (!data) continue;
    const found = data.items.find((g) => g.id === groupId);
    if (found) return found;
  }
  return null;
}

export function useAttachModifierGroup(productId: string) {
  const qc = useQueryClient();
  const linkKey = ['product', productId, 'modifier-groups'];
  return useMutation({
    mutationFn: (modifier_group_id: string) =>
      attachModifierGroup(productId, modifier_group_id),
    onMutate: async (modifier_group_id) => {
      await qc.cancelQueries({ queryKey: linkKey });
      const tempId = `tmp_${crypto.randomUUID()}`;
      // Best-effort lookup; if missing we fall back to a stub so the row still
      // renders and gets fixed up by onSettled's refetch.
      const cached = lookupGroupForAttach(qc, modifier_group_id);
      const stubGroup: ModifierGroup = cached ?? {
        id: modifier_group_id,
        name: '…',
        type: 'ADD',
        min_selection: 0,
        max_selection: 1,
        required: false,
        display_order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const optimistic: ModifierGroupLink = {
        id: tempId,
        product_id: productId,
        modifier_group_id,
        modifier_group: stubGroup,
      };
      qc.setQueryData<ModifierGroupLink[]>(linkKey, (old) => [
        ...(old ?? []),
        optimistic,
      ]);
      return { tempId };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      qc.setQueryData<ModifierGroupLink[]>(linkKey, (old) =>
        old?.filter((l) => l.id !== ctx.tempId),
      );
    },
    onSuccess: (server, _v, ctx) => {
      if (!ctx) return;
      qc.setQueryData<ModifierGroupLink[]>(linkKey, (old) =>
        old?.map((l) => (l.id === ctx.tempId ? server : l)),
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] });
      qc.invalidateQueries({ queryKey: linkKey });
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
