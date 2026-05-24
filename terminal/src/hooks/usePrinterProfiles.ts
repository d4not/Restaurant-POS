import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  assignCategories,
  testProfile,
  fetchRoutingMap,
  type CreateProfileInput,
  type UpdateProfileInput,
} from '../api/printer-profiles';

export function usePrinterProfiles() {
  return useQuery({
    queryKey: ['printer-profiles'],
    queryFn: fetchProfiles,
    staleTime: 60_000,
  });
}

export function usePrinterRoutingMap() {
  return useQuery({
    queryKey: ['printer-profiles', 'routing-map'],
    queryFn: fetchRoutingMap,
    staleTime: 60_000,
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProfileInput) => createProfile(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printer-profiles'] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProfileInput }) =>
      updateProfile(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printer-profiles'] }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProfile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printer-profiles'] }),
  });
}

export function useAssignCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ profileId, categoryIds }: { profileId: string; categoryIds: string[] }) =>
      assignCategories(profileId, categoryIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printer-profiles'] }),
  });
}

export function useTestProfile() {
  return useMutation({
    mutationFn: (id: string) => testProfile(id),
  });
}
