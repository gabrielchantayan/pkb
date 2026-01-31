import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function use_smart_lists() {
  return useQuery({
    queryKey: ['smart-lists'],
    queryFn: () => api.get_smart_lists(),
  });
}

export function use_create_smart_list() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; rules: object }) => api.create_smart_list(data),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['smart-lists'] }),
  });
}

export function use_delete_smart_list() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete_smart_list(id),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['smart-lists'] }),
  });
}
