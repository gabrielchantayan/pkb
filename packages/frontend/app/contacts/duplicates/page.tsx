'use client';

import { useState } from 'react';
import { useDuplicates } from '@/lib/hooks/use-contacts';
import { Contact } from '@/lib/api';
import { Avatar } from '@/components/shared/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MergeDialog } from '@/components/contacts/merge-dialog';
import { ArrowLeft, Merge, Loader2, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function DuplicatesPage() {
  const { data, isLoading, refetch } = useDuplicates();
  const [merge_pair, set_merge_pair] = useState<{ target: Contact; source: Contact } | null>(null);

  const duplicates = data?.duplicates ?? [];

  function get_reason_label(reason: string) {
    switch (reason) {
      case 'same_email':
        return 'Same email';
      case 'same_phone':
        return 'Same phone';
      case 'similar_name':
        return 'Similar name';
      default:
        return reason;
    }
  }

  function handle_merge_success() {
    set_merge_pair(null);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to contacts
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-bold">Duplicate Contacts</h1>
        <p className="text-muted-foreground mt-1">
          Review and merge contacts that may be duplicates.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : duplicates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="w-12 h-12 text-green-500 mb-4" />
            <h3 className="text-lg font-medium">No duplicates found</h3>
            <p className="text-muted-foreground text-center max-w-md mt-1">
              Your contacts are well organized. We didn&apos;t find any potential duplicates based
              on matching emails or phone numbers.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Found {duplicates.length} potential duplicate{duplicates.length !== 1 ? 's' : ''}
          </p>

          {duplicates.map((dup, index) => {
            const [contact_a, contact_b] = dup.contacts;
            return (
              <Card key={`${contact_a.id}-${contact_b.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{get_reason_label(dup.reason)}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(dup.confidence * 100)}% confidence
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => set_merge_pair({ target: contact_a, source: contact_b })}
                    >
                      <Merge className="w-4 h-4 mr-1" />
                      Merge
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <Link
                      href={`/contacts/${contact_a.id}`}
                      className="flex-1 flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <Avatar name={contact_a.display_name} size="md" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{contact_a.display_name}</div>
                        {contact_a.emails?.[0] && (
                          <div className="text-sm text-muted-foreground truncate">
                            {contact_a.emails[0]}
                          </div>
                        )}
                      </div>
                    </Link>

                    <div className="text-muted-foreground text-sm">and</div>

                    <Link
                      href={`/contacts/${contact_b.id}`}
                      className="flex-1 flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <Avatar name={contact_b.display_name} size="md" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{contact_b.display_name}</div>
                        {contact_b.emails?.[0] && (
                          <div className="text-sm text-muted-foreground truncate">
                            {contact_b.emails[0]}
                          </div>
                        )}
                      </div>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {merge_pair && (
        <MergeDialog
          open={!!merge_pair}
          on_close={() => set_merge_pair(null)}
          target={merge_pair.target}
          source={merge_pair.source}
          on_success={handle_merge_success}
        />
      )}
    </div>
  );
}
