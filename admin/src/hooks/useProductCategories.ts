import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createProductCategory,
  deleteProductCategory,
  getProductCategory,
  listProductCategories,
  updateProductCategory,
  type ListCategoriesParams,
} from '../api/product-categories';

/**
 * Pulls every category in one shot so the UI can assemble the tree client-side.
 * In a small menu this is fine; we raise the limit well past the expected count.
 */
export function useProductCategories(params: Omit<ListCategoriesParams, 'cursor' | 'limit'> = {}) {
  return useQuery({
    queryKey: ['product-categories', params],
    queryFn: () => listProductCategories({ ...params, limit: 100 }),
    staleTime: 30_000,
  });
}

export function useProductCategory(id: string | undefined) {
  return useQuery({
    queryKey: ['product-category', id],
    queryFn: () => getProductCategory(id as string),
    enabled: !!id,
  });
}

export function useCreateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProductCategory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}

export function useUpdateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updateProductCategory>[1];
    }) => updateProductCategory(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['product-categories'] });
      qc.invalidateQueries({ queryKey: ['product-category', data.id] });
    },
  });
}

export function useDeleteProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteProductCategory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}
