import { useQuery } from '@tanstack/react-query';
import {
  getProductCosts,
  getSupplyMovementsReport,
  getVariance,
} from '../api/reports';

export function useProductCostsReport(active_only = true) {
  return useQuery({
    queryKey: ['reports', 'product-costs', { active_only }],
    queryFn: () => getProductCosts({ active_only }),
  });
}

export function useVarianceReport(params: {
  from: string;
  to: string;
  storage_id?: string;
}) {
  return useQuery({
    queryKey: ['reports', 'variance', params],
    queryFn: () => getVariance(params),
    enabled: !!(params.from && params.to),
  });
}

export function useSupplyMovementsReport(params: {
  supply_id: string;
  storage_id?: string;
  from: string;
  to: string;
}) {
  return useQuery({
    queryKey: ['reports', 'supply-movements', params],
    queryFn: () => getSupplyMovementsReport(params),
    enabled: !!(params.supply_id && params.from && params.to),
  });
}
