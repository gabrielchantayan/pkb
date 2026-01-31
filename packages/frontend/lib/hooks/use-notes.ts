import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, Note } from '@/lib/api';

export function useNotes(contact_id: string) {
  return useQuery<{ notes: Note[] }>({
    queryKey: ['notes', contact_id],
    queryFn: () => api.get_notes(contact_id),
    enabled: !!contact_id,
  });
}

export function useCreateNote() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (data: { contact_id: string; content: string }) =>
      api.create_note(data),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['notes', variables.contact_id] });
    },
  });
}

export function useUpdateNote() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, contact_id, content }: { id: string; contact_id: string; content: string }) =>
      api.update_note(id, { content }),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['notes', variables.contact_id] });
    },
  });
}

export function useDeleteNote() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, contact_id }: { id: string; contact_id: string }) =>
      api.delete_note(id),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['notes', variables.contact_id] });
    },
  });
}
