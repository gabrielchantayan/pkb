import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useCreateFact() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (data: { contact_id: string; fact_type: string; value: string; category?: string }) =>
      api.create_fact(data),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['contact', variables.contact_id] });
    },
  });
}

export function useDeleteFact() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, contact_id }: { id: string; contact_id: string }) =>
      api.delete_fact(id),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['contact', variables.contact_id] });
    },
  });
}

export function useBulkDeleteFacts() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ ids }: { ids: string[]; contact_id: string }) =>
      api.bulk_delete_facts(ids),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['contact', variables.contact_id] });
    },
  });
}
