'use client';

import { useState } from 'react';
import { useContacts } from '@/lib/hooks/use-contacts';
import { ContactList } from '@/components/contacts/contact-list';
import { ContactFilters } from '@/components/contacts/contact-filters';
import { AddContactDialog } from '@/components/contacts/contact-form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Users } from 'lucide-react';
import Link from 'next/link';

export default function ContactsPage() {
  const [search, set_search] = useState('');
  const [filters, set_filters] = useState<{ starred?: boolean; has_followup?: boolean; saved_only?: boolean }>({
    saved_only: true,
  });

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useContacts({
    search,
    saved_only: filters.saved_only,
  });

  const contacts = data?.pages.flatMap((p) => p.contacts) || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Contacts</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/contacts/duplicates" />}>
            <Users className="w-4 h-4 mr-1" />
            Find Duplicates
          </Button>
          <AddContactDialog />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => set_search(e.target.value)}
            className="pl-10"
          />
        </div>
        <ContactFilters value={filters} on_change={set_filters} />
      </div>

      <ContactList contacts={contacts} is_loading={isLoading} />

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  );
}
