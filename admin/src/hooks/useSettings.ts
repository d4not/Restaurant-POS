import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { listSettings, updateSettings, type SettingsMap } from '../api/settings';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => listSettings(),
    // Settings rarely change during a session; a short stale window keeps the
    // Tax dropdown and Order detail quiet without a full cache miss per page.
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsMap) => updateSettings(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      // Changing the default tax doesn't rewrite historical orders but it DOES
      // affect new lines on already-open orders (tax is snapshotted on add).
      // Refresh products + orders so the UI reflects the new effective rate.
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
