'use client';

import { useParams } from 'next/navigation';
import { useContact } from '@/lib/hooks/use-contact';
import { ContactHeader } from '@/components/contact-detail/header';
import { FactsSection } from '@/components/contact-detail/facts-section';
import { Timeline } from '@/components/contact-detail/timeline';
import { NotesSection } from '@/components/contact-detail/notes-section';
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

  return (
    <div className="space-y-6">
      <ContactHeader
        contact={contact}
        identifiers={identifiers}
        tags={tags}
        groups={groups}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <FactsSection contact_id={contact.id} facts={facts} />
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
