import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createProductCategory,
  deleteProductCategory,
  listProductCategories,
  updateProductCategory,
} from '../api/product-categories';
import type {
  CreateCategoryInput,
  ProductCategory,
  UpdateCategoryInput,
} from '../api/product-categories';

export function useProductCategoriesAdmin() {
  return useQuery<ProductCategory[]>({
    queryKey: ['admin', 'productCategories'],
    queryFn: () => listProductCategories(),
    staleTime: 30_000,
  });
}

export function useCreateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => createProductCategory(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'productCategories'] });
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });
}

export function useUpdateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCategoryInput }) =>
      updateProductCategory(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'productCategories'] });
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });
}

export function useDeleteProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProductCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'productCategories'] });
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });
}
