import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, PendingFollowupsResponse, Followup } from '@/lib/api';

export function usePendingFollowups() {
  return useQuery<PendingFollowupsResponse>({
    queryKey: ['followups', 'pending'],
    queryFn: () => api.get_pending_followups(),
  });
}

export function useContactFollowups(contact_id: string) {
  return useQuery<{ followups: Followup[] }>({
    queryKey: ['followups', 'contact', contact_id],
    queryFn: () => api.get_contact_followups(contact_id),
    enabled: !!contact_id,
  });
}

export function useCreateFollowup() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (data: { contact_id: string; reason: string; due_date: string }) =>
      api.create_followup(data),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['followups'] });
      query_client.invalidateQueries({ queryKey: ['followups', 'contact', variables.contact_id] });
    },
  });
}

export function useCompleteFollowup() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.complete_followup(id),
    onSuccess: () => {
      query_client.invalidateQueries({ queryKey: ['followups'] });
    },
  });
}

export function useDismissFollowup() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.dismiss_followup(id),
    onSuccess: () => {
      query_client.invalidateQueries({ queryKey: ['followups'] });
    },
  });
}
