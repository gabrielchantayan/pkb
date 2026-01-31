'use client';

import { useState } from 'react';
import { useNotes, useCreateNote, useDeleteNote } from '@/lib/hooks/use-notes';
import { Note } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingCard } from '@/components/shared/loading';
import { EmptyState } from '@/components/shared/empty-state';
import { format_date } from '@/lib/utils';
import { Plus, Trash2, FileText } from 'lucide-react';

interface NotesSectionProps {
  contact_id: string;
}

export function NotesSection({ contact_id }: NotesSectionProps) {
  const { data, isLoading } = useNotes(contact_id);
  const [show_form, set_show_form] = useState(false);

  if (isLoading) {
    return <LoadingCard />;
  }

  const notes = data?.notes || [];

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-medium">Notes</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => set_show_form(!show_form)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Note
          </Button>
        </div>

        {show_form && (
          <NoteForm
            contact_id={contact_id}
            on_cancel={() => set_show_form(false)}
            on_success={() => set_show_form(false)}
          />
        )}

        {notes.length > 0 ? (
          <div className="space-y-3">
            {notes.map((note) => (
              <NoteItem key={note.id} note={note} contact_id={contact_id} />
            ))}
          </div>
        ) : (
          !show_form && (
            <EmptyState
              icon={FileText}
              title="No notes yet"
              description="Add notes to remember important details about this contact"
            />
          )
        )}
      </CardContent>
    </Card>
  );
}

function NoteForm({
  contact_id,
  on_cancel,
  on_success,
}: {
  contact_id: string;
  on_cancel: () => void;
  on_success: () => void;
}) {
  const [content, set_content] = useState('');
  const { mutate: create_note, isPending } = useCreateNote();

  function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    create_note(
      { contact_id, content: content.trim() },
      { onSuccess: on_success }
    );
  }

  return (
    <form onSubmit={handle_submit} className="space-y-3">
      <Textarea
        placeholder="Write a note..."
        value={content}
        onChange={(e) => set_content(e.target.value)}
        rows={4}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={on_cancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !content.trim()}>
          {isPending ? 'Saving...' : 'Save Note'}
        </Button>
      </div>
    </form>
  );
}

function NoteItem({ note, contact_id }: { note: Note; contact_id: string }) {
  const { mutate: delete_note, isPending } = useDeleteNote();

  return (
    <div className="p-3 rounded-lg border bg-muted/30 group">
      <div className="flex justify-between items-start mb-2">
        <span className="text-xs text-muted-foreground">
          {format_date(note.created_at)}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => delete_note({ id: note.id, contact_id })}
          disabled={isPending}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      <p className="text-sm whitespace-pre-wrap">{note.content}</p>
    </div>
  );
}
