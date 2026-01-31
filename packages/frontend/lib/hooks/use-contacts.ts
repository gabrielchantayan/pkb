import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, Contact, ContactsResponse } from '@/lib/api';

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
