'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Relationship } from '@/lib/api';
import {
  use_relationships,
  use_create_relationship,
  use_delete_relationship,
} from '@/lib/hooks/use-relationships';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { ContactPickerDialog } from '@/components/contacts/contact-picker-dialog';
import { Plus, Trash2, Sparkles, Link as LinkIcon } from 'lucide-react';

interface RelationshipsSectionProps {
  contact_id: string;
}

const COMMON_LABELS = [
  'spouse',
  'child',
  'parent',
  'sibling',
  'friend',
  'colleague',
  'boss',
  'mentor',
  'how_we_met',
];

const LABEL_DISPLAY: Record<string, string> = {
  spouse: 'Spouse',
  child: 'Children',
  parent: 'Parents',
  sibling: 'Siblings',
  friend: 'Friends',
  colleague: 'Colleagues',
  boss: 'Boss',
  mentor: 'Mentors',
  how_we_met: 'How We Met',
};

function format_label(label: string): string {
  return LABEL_DISPLAY[label] || label.charAt(0).toUpperCase() + label.slice(1);
}

export function RelationshipsSection({ contact_id }: RelationshipsSectionProps) {
  const [show_form, set_show_form] = useState(false);
  const { data } = use_relationships(contact_id);
  const relationships = data?.relationships ?? [];

  // Group by label
  const grouped = relationships.reduce(
    (acc, rel) => {
      const key = rel.label;
      if (!acc[key]) acc[key] = [];
      acc[key].push(rel);
      return acc;
    },
    {} as Record<string, Relationship[]>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Relationships</CardTitle>
        <AddRelationshipDialog
          contact_id={contact_id}
          open={show_form}
          on_open_change={set_show_form}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(grouped).map(([label, rels]) => (
          <div key={label}>
            <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              {format_label(label)}
            </h3>
            <div className="space-y-1">
              {rels.map((rel) => (
                <RelationshipItem key={rel.id} relationship={rel} contact_id={contact_id} />
              ))}
            </div>
          </div>
        ))}

        {relationships.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">
            No relationships recorded yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RelationshipItem({ relationship, contact_id }: { relationship: Relationship; contact_id: string }) {
  const { mutate: delete_relationship, isPending } = use_delete_relationship();

  return (
    <div className="flex items-center justify-between py-1.5 group">
      <div className="flex items-center gap-2 min-w-0">
        {relationship.linked_contact_id ? (
          <Link
            href={`/contacts/${relationship.linked_contact_id}`}
            className="text-sm text-primary hover:underline truncate flex items-center gap-1"
          >
            <LinkIcon className="w-3 h-3 shrink-0" />
            {relationship.person_name}
          </Link>
        ) : (
          <span className="text-sm truncate">{relationship.person_name}</span>
        )}
        {relationship.source === 'extracted' && (
          <span title="AI extracted">
            <Sparkles className="w-3 h-3 text-purple-500" />
          </span>
        )}
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => delete_relationship({ id: relationship.id, contact_id })}
        disabled={isPending}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

function AddRelationshipDialog({
  contact_id,
  open,
  on_open_change,
}: {
  contact_id: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
}) {
  const [label, set_label] = useState('');
  const [custom_label, set_custom_label] = useState('');
  const [person_name, set_person_name] = useState('');
  const [linked_contact_id, set_linked_contact_id] = useState<string | undefined>();
  const [linked_contact_name, set_linked_contact_name] = useState('');
  const [show_picker, set_show_picker] = useState(false);
  const { mutate: create_relationship, isPending } = use_create_relationship();

  const effective_label = label === 'custom' ? custom_label : label;

  function reset() {
    set_label('');
    set_custom_label('');
    set_person_name('');
    set_linked_contact_id(undefined);
    set_linked_contact_name('');
  }

  function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    if (!effective_label || !person_name) return;

    create_relationship(
      { contact_id, label: effective_label, person_name, linked_contact_id },
      {
        onSuccess: () => {
          on_open_change(false);
          reset();
        },
      }
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { on_open_change(o); if (!o) reset(); }}>
        <DialogTrigger render={<Button size="icon-xs" variant="ghost" />}>
          <Plus className="w-4 h-4" />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Relationship</DialogTitle>
          </DialogHeader>
          <form onSubmit={handle_submit} className="space-y-4">
            <div>
              <Select value={label} onValueChange={(val) => val && set_label(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Relationship type" />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_LABELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {format_label(l)}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom...</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {label === 'custom' && (
              <div>
                <Input
                  placeholder="Custom label (e.g., Roommate)"
                  value={custom_label}
                  onChange={(e) => set_custom_label(e.target.value)}
                  required
                />
              </div>
            )}
            <div>
              <Input
                placeholder="Person name"
                value={person_name}
                onChange={(e) => set_person_name(e.target.value)}
                required
              />
            </div>
            <div>
              {linked_contact_name ? (
                <div className="flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">{linked_contact_name}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { set_linked_contact_id(undefined); set_linked_contact_name(''); }}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => set_show_picker(true)}>
                  <LinkIcon className="w-3 h-3 mr-1" />
                  Link to contact
                </Button>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { on_open_change(false); reset(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !effective_label || !person_name}>
                {isPending ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ContactPickerDialog
        open={show_picker}
        on_close={() => set_show_picker(false)}
        on_select={(contact) => {
          set_linked_contact_id(contact.id);
          set_linked_contact_name(contact.display_name);
          if (!person_name) {
            set_person_name(contact.display_name);
          }
        }}
        exclude_id={contact_id}
        title="Link to Contact"
        description="Search for a contact to link this relationship to."
      />
    </>
  );
}
