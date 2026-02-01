import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Contact, ContactsResponse, DuplicateSuggestion, MergePreview } from '@/lib/api';

interface UseContactsParams {
  search?: string;
  limit?: number;
}

export function useContacts(params: UseContactsParams = {}) {
  return useInfiniteQuery<ContactsResponse>({
    queryKey: ['contacts', params.search],
    queryFn: ({ pageParam }) =>
      api.get_contacts({
        search: params.search,
        cursor: pageParam as string | undefined,
        limit: params.limit || 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last_page) => last_page.next_cursor ?? undefined,
  });
}

export function useCreateContact() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (data: { display_name: string; emails?: string[]; phone_numbers?: string[] }) =>
      api.create_contact(data),
    onSuccess: () => {
      query_client.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useStarContact() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) =>
      api.star_contact(id, starred),
    onSuccess: () => {
      query_client.invalidateQueries({ queryKey: ['contacts'] });
      query_client.invalidateQueries({ queryKey: ['contact'] });
    },
  });
}

export function useDuplicates() {
  return useQuery<{ duplicates: DuplicateSuggestion[] }>({
    queryKey: ['duplicates'],
    queryFn: () => api.get_duplicates(),
  });
}

export function useMergePreview(target_id: string | null, source_id: string | null) {
  return useQuery<MergePreview>({
    queryKey: ['merge-preview', target_id, source_id],
    queryFn: () => api.get_merge_preview(target_id!, source_id!),
    enabled: !!target_id && !!source_id,
  });
}

export function useMergeContacts() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ target_id, source_id }: { target_id: string; source_id: string }) =>
      api.merge_contacts(target_id, source_id),
    onSuccess: () => {
      query_client.invalidateQueries({ queryKey: ['contacts'] });
      query_client.invalidateQueries({ queryKey: ['contact'] });
      query_client.invalidateQueries({ queryKey: ['communications'] });
      query_client.invalidateQueries({ queryKey: ['notes'] });
      query_client.invalidateQueries({ queryKey: ['followups'] });
      query_client.invalidateQueries({ queryKey: ['duplicates'] });
    },
  });
}
