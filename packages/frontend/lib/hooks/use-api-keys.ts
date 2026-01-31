import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function use_api_keys() {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get_api_keys(),
  });
}

export function use_create_api_key() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.create_api_key(name),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

export function use_delete_api_key() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete_api_key(id),
    onSuccess: () => query_client.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}
