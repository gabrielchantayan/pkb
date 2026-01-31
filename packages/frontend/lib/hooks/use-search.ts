import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

interface SearchParams {
  query: string;
  mode?: 'keyword' | 'semantic' | 'combined';
  types?: string[];
  filters?: object;
}

export function use_search(params: SearchParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['search', params],
    queryFn: () => api.search(params),
    enabled: options?.enabled ?? true,
  });
}
