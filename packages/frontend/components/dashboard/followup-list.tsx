'use client';

import Link from 'next/link';
import { usePendingFollowups, useCompleteFollowup } from '@/lib/hooks/use-followups';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/shared/avatar';
import { LoadingCard } from '@/components/shared/loading';
import { format_relative_date } from '@/lib/utils';
import { Check, Clock } from 'lucide-react';
import { Followup } from '@/lib/api';

export function FollowupList() {
  const { data, isLoading } = usePendingFollowups();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Follow-ups</CardTitle>
        </CardHeader>
        <LoadingCard />
      </Card>
    );
  }

  const has_followups =
    (data?.overdue?.length ?? 0) > 0 ||
    (data?.today?.length ?? 0) > 0 ||
    (data?.upcoming?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Follow-ups
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data?.overdue && data.overdue.length > 0 && (
          <div>
            <Badge variant="destructive" className="mb-2">
              Overdue ({data.overdue.length})
            </Badge>
            <div className="space-y-2">
              {data.overdue.map((followup) => (
                <FollowupItem key={followup.id} followup={followup} />
              ))}
            </div>
          </div>
        )}

        {data?.today && data.today.length > 0 && (
          <div>
            <Badge className="mb-2">Today ({data.today.length})</Badge>
            <div className="space-y-2">
              {data.today.map((followup) => (
                <FollowupItem key={followup.id} followup={followup} />
              ))}
            </div>
          </div>
        )}

        {data?.upcoming && data.upcoming.length > 0 && (
          <div>
            <Badge variant="secondary" className="mb-2">
              Upcoming ({data.upcoming.length})
            </Badge>
            <div className="space-y-2">
              {data.upcoming.map((followup) => (
                <FollowupItem key={followup.id} followup={followup} />
              ))}
            </div>
          </div>
        )}

        {!has_followups && (
          <p className="text-muted-foreground text-sm py-4 text-center">
            No pending follow-ups
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FollowupItem({ followup }: { followup: Followup }) {
  const { mutate: complete, isPending } = useCompleteFollowup();

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-xl border border-border/60 bg-background/60">
      <Link
        href={`/contacts/${followup.contact_id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <Avatar
          name={followup.contact_name}
          url={followup.contact_photo}
          size="sm"
        />
        <div className="min-w-0">
          <p className="font-medium truncate">{followup.contact_name}</p>
          <p className="text-sm text-muted-foreground truncate">
            {followup.reason}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-2 ml-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {format_relative_date(followup.due_date)}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={(e) => {
            e.preventDefault();
            complete(followup.id);
          }}
          disabled={isPending}
        >
          <Check className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
