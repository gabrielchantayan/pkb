import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function use_tags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get_tags(),
  });
}

export function use_create_tag() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string; followup_days?: number }) =>
      api.create_tag(data),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function use_delete_tag() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete_tag(id),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['tags'] }),
  });
}
