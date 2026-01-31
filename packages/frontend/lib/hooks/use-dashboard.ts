import { useQuery } from '@tanstack/react-query';
import { api, DashboardData } from '@/lib/api';

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get_dashboard(),
  });
}
