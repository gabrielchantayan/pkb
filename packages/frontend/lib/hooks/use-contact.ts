import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ContactDetailResponse, Contact } from '@/lib/api';

export function useContact(id: string) {
  return useQuery<ContactDetailResponse>({
    queryKey: ['contact', id],
    queryFn: () => api.get_contact(id),
    enabled: !!id,
  });
}

export function useUpdateContact() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Contact> }) =>
      api.update_contact(id, data),
    onSuccess: (_, variables) => {
      query_client.invalidateQueries({ queryKey: ['contact', variables.id] });
      query_client.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
