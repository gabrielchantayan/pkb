import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function use_relationship_graph() {
  return useQuery({
    queryKey: ['relationship-graph'],
    queryFn: () => api.get_relationship_graph(),
  });
}
