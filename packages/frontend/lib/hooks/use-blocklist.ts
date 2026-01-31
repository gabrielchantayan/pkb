import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function use_blocklist() {
  return useQuery({
    queryKey: ['blocklist'],
    queryFn: () => api.get_blocklist(),
  });
}

export function use_add_to_blocklist() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (data: { identifier: string; identifier_type: string }) =>
      api.add_to_blocklist(data.identifier, data.identifier_type),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['blocklist'] }),
  });
}

export function use_remove_from_blocklist() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.remove_from_blocklist(id),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['blocklist'] }),
  });
}
