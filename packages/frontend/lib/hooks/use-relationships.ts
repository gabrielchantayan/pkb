import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function use_relationships(contact_id: string) {
  return useQuery({
    queryKey: ['relationships', contact_id],
    queryFn: () => api.get_relationships(contact_id),
  });
}

export function use_create_relationship() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (data: { contact_id: string; label: string; person_name: string; linked_contact_id?: string }) =>
      api.create_relationship(data),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['relationships', variables.contact_id] });
    },
  });
}

export function use_update_relationship() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, contact_id, ...data }: { id: string; contact_id: string; label?: string; person_name?: string; linked_contact_id?: string | null }) =>
      api.update_relationship(id, data),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['relationships', variables.contact_id] });
    },
  });
}

export function use_delete_relationship() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; contact_id: string }) =>
      api.delete_relationship(id),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['relationships', variables.contact_id] });
    },
  });
}

export function use_relationship_graph() {
  return useQuery({
    queryKey: ['relationship-graph'],
    queryFn: () => api.get_relationship_graph(),
  });
}
