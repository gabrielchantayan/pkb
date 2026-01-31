import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function use_groups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get_groups(),
  });
}

export function use_create_group() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; parent_id?: string; followup_days?: number }) =>
      api.create_group(data),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function use_delete_group() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete_group(id),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['groups'] }),
  });
}
