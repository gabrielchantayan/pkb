'use client';

import { useState } from 'react';
import { useMergePreview, useMergeContacts } from '@/lib/hooks/use-contacts';
import { Contact } from '@/lib/api';
import { Avatar } from '@/components/shared/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowRight, Mail, Phone, MessageSquare, FileText, CheckSquare, Tag, Users, Loader2 } from 'lucide-react';

interface MergeDialogProps {
  open: boolean;
  on_close: () => void;
  target: Contact;
  source: Contact;
  on_success?: () => void;
}

export function MergeDialog({ open, on_close, target, source, on_success }: MergeDialogProps) {
  const [swapped, set_swapped] = useState(false);
  const actual_target = swapped ? source : target;
  const actual_source = swapped ? target : source;

  const { data: preview, isLoading: preview_loading } = useMergePreview(
    open ? actual_target.id : null,
    open ? actual_source.id : null
  );

  const { mutate: merge, isPending: merge_pending } = useMergeContacts();

  function handle_merge() {
    merge(
      { target_id: actual_target.id, source_id: actual_source.id },
      {
        onSuccess: () => {
          on_close();
          on_success?.();
        },
      }
    );
  }

  const counts = preview?.counts;
  const total_items =
    (counts?.communications ?? 0) +
    (counts?.facts ?? 0) +
    (counts?.notes ?? 0) +
    (counts?.followups ?? 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && on_close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge Contacts</DialogTitle>
          <DialogDescription>
            Combine two contact records into one. All data from the source contact will be moved to
            the target.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contact comparison */}
          <div className="flex items-center gap-3">
            <div className="flex-1 p-3 rounded-lg border bg-muted/30">
              <div className="text-xs text-muted-foreground mb-2">Keep (target)</div>
              <div className="flex items-center gap-2">
                <Avatar name={actual_target.display_name} size="sm" />
                <span className="font-medium truncate">{actual_target.display_name}</span>
              </div>
            </div>

            <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />

            <div className="flex-1 p-3 rounded-lg border">
              <div className="text-xs text-muted-foreground mb-2">Merge from (source)</div>
              <div className="flex items-center gap-2">
                <Avatar name={actual_source.display_name} size="sm" />
                <span className="font-medium truncate">{actual_source.display_name}</span>
              </div>
            </div>
          </div>

          <Button variant="ghost" size="sm" className="w-full" onClick={() => set_swapped(!swapped)}>
            Swap target and source
          </Button>

          {/* Preview counts */}
          {preview_loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : counts ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">What will be merged:</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {counts.identifiers > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="w-4 h-4" />
                    <span>{counts.identifiers} identifier{counts.identifiers !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {counts.communications > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MessageSquare className="w-4 h-4" />
                    <span>{counts.communications} message{counts.communications !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {counts.facts > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="w-4 h-4" />
                    <span>{counts.facts} fact{counts.facts !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {counts.notes > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="w-4 h-4" />
                    <span>{counts.notes} note{counts.notes !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {counts.followups > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CheckSquare className="w-4 h-4" />
                    <span>{counts.followups} followup{counts.followups !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {counts.tags > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Tag className="w-4 h-4" />
                    <span>{counts.tags} tag{counts.tags !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {counts.groups > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>{counts.groups} group{counts.groups !== 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
              {total_items === 0 && counts.identifiers === 0 && (
                <div className="text-sm text-muted-foreground">No additional data to merge.</div>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={on_close} disabled={merge_pending}>
            Cancel
          </Button>
          <Button onClick={handle_merge} disabled={merge_pending || preview_loading}>
            {merge_pending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Merging...
              </>
            ) : (
              'Merge Contacts'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
