import { useInfiniteQuery } from '@tanstack/react-query';
import { api, CommunicationsResponse, Communication } from '@/lib/api';

interface UseCommunicationsParams {
  contact_id: string;
  initial?: Communication[];
}

export function useCommunications({ contact_id, initial }: UseCommunicationsParams) {
  return useInfiniteQuery<CommunicationsResponse>({
    queryKey: ['communications', contact_id],
    queryFn: ({ pageParam }) =>
      api.get_communications({
        contact_id,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last_page) => last_page.next_cursor ?? undefined,
    initialData: initial
      ? {
          pages: [{ communications: initial, next_cursor: null }],
          pageParams: [undefined],
        }
      : undefined,
  });
}
