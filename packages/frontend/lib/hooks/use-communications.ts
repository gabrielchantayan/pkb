import { useInfiniteQuery } from '@tanstack/react-query';
import { api, CommunicationsResponse } from '@/lib/api';

interface UseCommunicationsParams {
  contact_id: string;
}

export function useCommunications({ contact_id }: UseCommunicationsParams) {
  return useInfiniteQuery<CommunicationsResponse>({
    queryKey: ['communications', contact_id],
    queryFn: ({ pageParam }) =>
      api.get_communications({
        contact_id,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last_page) => last_page.nextCursor ?? undefined,
  });
}
