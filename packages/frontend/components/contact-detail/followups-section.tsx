'use client';

import { useState } from 'react';
import {
  useContactFollowups,
  useCreateFollowup,
  useCompleteFollowup,
  useDismissFollowup,
} from '@/lib/hooks/use-followups';
import { Followup } from '@/lib/api';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LoadingCard } from '@/components/shared/loading';
import { format_relative_date } from '@/lib/utils';
import { Plus, Check, X, Clock } from 'lucide-react';

interface FollowupsSectionProps {
  contact_id: string;
}

export function FollowupsSection({ contact_id }: FollowupsSectionProps) {
  const { data, isLoading } = useContactFollowups(contact_id);
  const [show_form, set_show_form] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Follow-ups</CardTitle>
        </CardHeader>
        <LoadingCard />
      </Card>
    );
  }

  const followups = data?.followups || [];
  const pending = followups.filter((f) => f.status === 'pending');
  const completed = followups.filter((f) => f.status !== 'pending');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Follow-ups
        </CardTitle>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => set_show_form(!show_form)}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {show_form && (
          <FollowupForm
            contact_id={contact_id}
            on_cancel={() => set_show_form(false)}
            on_success={() => set_show_form(false)}
          />
        )}

        {pending.length > 0 && (
          <div className="space-y-2">
            {pending.map((followup) => (
              <FollowupItem key={followup.id} followup={followup} />
            ))}
          </div>
        )}

        {completed.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs text-muted-foreground">Completed</p>
            {completed.slice(0, 3).map((followup) => (
              <div key={followup.id} className="text-sm text-muted-foreground line-through">
                {followup.reason}
              </div>
            ))}
          </div>
        )}

        {!show_form && pending.length === 0 && completed.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-2">
            No follow-ups scheduled
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FollowupForm({
  contact_id,
  on_cancel,
  on_success,
}: {
  contact_id: string;
  on_cancel: () => void;
  on_success: () => void;
}) {
  const [reason, set_reason] = useState('');
  const [due_date, set_due_date] = useState('');
  const { mutate: create_followup, isPending } = useCreateFollowup();

  function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || !due_date) return;

    create_followup(
      { contact_id, reason: reason.trim(), due_date },
      { onSuccess: on_success }
    );
  }

  return (
    <form onSubmit={handle_submit} className="space-y-2 p-2 bg-muted/50 rounded-lg">
      <Input
        placeholder="Reason for follow-up..."
        value={reason}
        onChange={(e) => set_reason(e.target.value)}
        required
      />
      <Input
        type="date"
        value={due_date}
        onChange={(e) => set_due_date(e.target.value)}
        required
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={on_cancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Adding...' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

function FollowupItem({ followup }: { followup: Followup }) {
  const { mutate: complete, isPending: completing } = useCompleteFollowup();
  const { mutate: dismiss, isPending: dismissing } = useDismissFollowup();
  const is_overdue = new Date(followup.due_date) < new Date();

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/30">
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{followup.reason}</p>
        <span className={`text-xs ${is_overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
          {format_relative_date(followup.due_date)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => complete(followup.id)}
          disabled={completing}
          title="Complete"
        >
          <Check className="w-3 h-3" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => dismiss(followup.id)}
          disabled={dismissing}
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
