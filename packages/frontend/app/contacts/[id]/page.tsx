'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useContact } from '@/lib/hooks/use-contact';
import { ContactHeader } from '@/components/contact-detail/header';
import { FactsSection } from '@/components/contact-detail/facts-section';
import { Timeline } from '@/components/contact-detail/timeline';
import { NotesSection } from '@/components/contact-detail/notes-section';
import { RelationshipsSection } from '@/components/contact-detail/relationships-section';
import { FollowupsSection } from '@/components/contact-detail/followups-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingPage } from '@/components/shared/loading';

export default function ContactDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { data, isLoading } = useContact(id);

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-medium">Contact not found</h2>
        <p className="text-muted-foreground">
          The contact you&apos;re looking for doesn&apos;t exist or has been deleted.
        </p>
      </div>
    );
  }

  const { contact, identifiers, facts, recent_communications, tags, groups } = data;

  // Note: processing_status will be undefined until we add the backend endpoint

  return (
    <div className="space-y-6">
      <ContactHeader
        contact={contact}
        identifiers={identifiers}
        tags={tags}
        groups={groups}
      />
      <ProcessingStatus contact_id={contact.id} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <FactsSection contact_id={contact.id} facts={facts} />
          <RelationshipsSection contact_id={contact.id} />
          <FollowupsSection contact_id={contact.id} />
        </div>

        <div className="lg:col-span-2">
          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="mt-4">
              <Timeline contact_id={contact.id} />
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <NotesSection contact_id={contact.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function ProcessingStatus({ contact_id }: { contact_id: string }) {
  const { data } = useQuery<{ pending_count: number; last_processed: string | null }>({
    queryKey: ['processing-status', contact_id],
    queryFn: () => api.get_processing_status(contact_id),
    retry: false,
    refetchInterval: 30000,
  });

  if (!data) return null;

  return (
    <p className="text-xs text-muted-foreground -mt-4">
      {data.pending_count > 0
        ? `Processing pending (${data.pending_count} new messages)`
        : data.last_processed
          ? `Last processed: ${format_relative(data.last_processed)}`
          : 'No messages processed yet'}
    </p>
  );
}

function format_relative(date_str: string): string {
  const date = new Date(date_str);
  const now = new Date();
  const diff_ms = now.getTime() - date.getTime();
  const diff_mins = Math.floor(diff_ms / 60000);

  if (diff_mins < 1) return 'just now';
  if (diff_mins < 60) return `${diff_mins}m ago`;
  const diff_hours = Math.floor(diff_mins / 60);
  if (diff_hours < 24) return `${diff_hours}h ago`;
  const diff_days = Math.floor(diff_hours / 24);
  return `${diff_days}d ago`;
}
