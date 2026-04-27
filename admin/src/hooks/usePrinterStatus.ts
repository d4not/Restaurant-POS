import { useQuery } from '@tanstack/react-query';
import { getPrinterStatus } from '../api/print';

// Polled at a slow cadence — printer reachability rarely flips, but the dot
// in the Settings page should reflect a downed printer within a minute.
export function usePrinterStatus() {
  return useQuery({
    queryKey: ['printer-status'],
    queryFn: () => getPrinterStatus(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
