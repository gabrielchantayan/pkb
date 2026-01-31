import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function use_ai_query(query: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['ai-query', query],
    queryFn: () => api.ai_query(query),
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
}
