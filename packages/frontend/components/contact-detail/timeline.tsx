'use client';

import { useCommunications } from '@/lib/hooks/use-communications';
import { Communication } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingCard } from '@/components/shared/loading';
import { EmptyState } from '@/components/shared/empty-state';
import { format_date_time } from '@/lib/utils';
import { MessageSquare, Mail, Phone, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

interface TimelineProps {
  contact_id: string;
  initial?: Communication[];
}

const source_icons: Record<string, typeof Mail> = {
  email: Mail,
  imessage: MessageSquare,
  sms: MessageSquare,
  call: Phone,
};

export function Timeline({ contact_id, initial }: TimelineProps) {
  const { data, fetchNextPage, hasNextPage, isLoading, isFetchingNextPage } =
    useCommunications({ contact_id, initial });

  if (isLoading && !initial) {
    return <LoadingCard />;
  }

  const communications = data?.pages.flatMap((p) => p.communications) || [];

  if (communications.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <EmptyState
            icon={MessageSquare}
            title="No communications yet"
            description="Communications will appear here as they're synced"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="divide-y p-0">
        {communications.map((comm) => (
          <CommunicationItem key={comm.id} communication={comm} />
        ))}

        {hasNextPage && (
          <div className="py-4 flex justify-center">
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading...' : 'Load More'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CommunicationItem({ communication }: { communication: Communication }) {
  const Icon = source_icons[communication.source.toLowerCase()] || MessageSquare;
  const DirectionIcon = communication.direction === 'inbound' ? ArrowDownLeft : ArrowUpRight;

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 rounded bg-muted">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <Badge
          variant={communication.direction === 'inbound' ? 'default' : 'secondary'}
          className="gap-1"
        >
          <DirectionIcon className="w-3 h-3" />
          {communication.direction === 'inbound' ? 'Received' : 'Sent'}
        </Badge>
        <Badge variant="outline">{communication.source}</Badge>
        <span className="text-xs text-muted-foreground ml-auto">
          {format_date_time(communication.timestamp)}
        </span>
      </div>

      {communication.subject && (
        <h4 className="font-medium mb-1 text-sm">{communication.subject}</h4>
      )}

      <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
        {communication.content}
      </p>
    </div>
  );
}
