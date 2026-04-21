import { useQuery } from '@tanstack/react-query';
import { listStorages } from '../api/storages';

export function useStorages() {
  return useQuery({
    queryKey: ['storages'],
    queryFn: () => listStorages({ limit: 100 }),
    staleTime: 60_000,
  });
}
