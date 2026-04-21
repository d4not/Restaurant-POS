import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  addRecipeItem,
  createProductRecipe,
  createVariantRecipe,
  deleteRecipe,
  deleteRecipeItem,
  getProductRecipe,
  getVariantRecipe,
  updateRecipe,
  updateRecipeItem,
} from '../api/recipes';

type RecipeOwner =
  | { kind: 'product'; id: string }
  | { kind: 'variant'; id: string };

function ownerKey(owner: RecipeOwner | undefined): readonly unknown[] {
  if (!owner) return ['recipe', 'none'];
  return owner.kind === 'product'
    ? ['recipe', 'product', owner.id]
    : ['recipe', 'variant', owner.id];
}

function fetchRecipeByOwner(owner: RecipeOwner) {
  return owner.kind === 'product'
    ? getProductRecipe(owner.id)
    : getVariantRecipe(owner.id);
}

function invalidationsFor(owner: RecipeOwner): unknown[][] {
  // Recipe changes move Product.recipe_cost on the backend, so refresh the
  // product detail view as well so the header stats stay in sync.
  return [
    ownerKey(owner) as unknown[],
    owner.kind === 'product'
      ? ['product', owner.id]
      : ['product', 'by-variant', owner.id],
    ['products'],
  ];
}

export function useRecipe(owner: RecipeOwner | undefined) {
  return useQuery({
    queryKey: ownerKey(owner),
    queryFn: () => fetchRecipeByOwner(owner as RecipeOwner),
    enabled: !!owner,
  });
}

export function useCreateRecipe(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createProductRecipe>[1]) =>
      owner.kind === 'product'
        ? createProductRecipe(owner.id, input)
        : createVariantRecipe(owner.id, input),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useUpdateRecipe(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      recipeId,
      input,
    }: {
      recipeId: string;
      input: Parameters<typeof updateRecipe>[1];
    }) => updateRecipe(recipeId, input),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useDeleteRecipe(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string) => deleteRecipe(recipeId),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useAddRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      recipeId,
      input,
    }: {
      recipeId: string;
      input: Parameters<typeof addRecipeItem>[1];
    }) => addRecipeItem(recipeId, input),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useUpdateRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      recipeId,
      itemId,
      input,
    }: {
      recipeId: string;
      itemId: string;
      input: Parameters<typeof updateRecipeItem>[2];
    }) => updateRecipeItem(recipeId, itemId, input),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useDeleteRecipeItem(owner: RecipeOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recipeId, itemId }: { recipeId: string; itemId: string }) =>
      deleteRecipeItem(recipeId, itemId),
    onSuccess: () => {
      for (const key of invalidationsFor(owner)) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
