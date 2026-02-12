'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Relationship } from '@/lib/api';
import {
  use_relationships,
  use_create_relationship,
  use_update_relationship,
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
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxEmpty,
} from '@/components/ui/combobox';
import { ContactPickerDialog } from '@/components/contacts/contact-picker-dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Sparkles, Link as LinkIcon, ArrowRight, Check } from 'lucide-react';

interface RelationshipsSectionProps {
  contact_id: string;
}

const RELATIONSHIP_CATEGORIES: Record<string, string[]> = {
  'Family': ['spouse', 'partner', 'child', 'parent', 'sibling'],
  'Work': ['colleague', 'boss', 'direct_report', 'mentor', 'mentee', 'client', 'provider', 'professional_connection'],
  'Social': ['friend', 'roommate', 'neighbor', 'ex', 'former_friend'],
  'Medical': ['doctor', 'patient', 'therapist'],
  'Education': ['teacher', 'student'],
  'Other': ['how_we_met'],
};

const COMMON_LABELS = Object.values(RELATIONSHIP_CATEGORIES).flat();

const LABEL_DISPLAY: Record<string, string> = {
  spouse: 'Spouse',
  partner: 'Partner',
  child: 'Children',
  parent: 'Parents',
  sibling: 'Siblings',
  friend: 'Friends',
  colleague: 'Colleagues',
  boss: 'Boss',
  direct_report: 'Direct Reports',
  mentor: 'Mentors',
  mentee: 'Mentees',
  roommate: 'Roommates',
  ex: 'Ex',
  client: 'Clients',
  provider: 'Providers',
  professional_connection: 'Professional Connection',
  neighbor: 'Neighbors',
  teacher: 'Teachers',
  student: 'Students',
  doctor: 'Doctors',
  patient: 'Patients',
  therapist: 'Therapists',
  former_friend: 'Former Friends',
  how_we_met: 'How We Met',
};

function format_label(label: string): string {
  return LABEL_DISPLAY[label] || label.charAt(0).toUpperCase() + label.slice(1);
}

export function RelationshipsSection({ contact_id }: RelationshipsSectionProps) {
  const [show_form, set_show_form] = useState(false);
  const [editing, set_editing] = useState<Relationship | null>(null);
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

  function handle_edit(rel: Relationship) {
    set_editing(rel);
    set_show_form(true);
  }

  function handle_open_change(open: boolean) {
    set_show_form(open);
    if (!open) set_editing(null);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Relationships</CardTitle>
        <RelationshipDialog
          contact_id={contact_id}
          open={show_form}
          on_open_change={handle_open_change}
          relationship={editing}
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
                <RelationshipItem
                  key={rel.id}
                  relationship={rel}
                  contact_id={contact_id}
                  on_edit={() => handle_edit(rel)}
                />
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

function RelationshipItem({
  relationship,
  contact_id,
  on_edit,
}: {
  relationship: Relationship;
  contact_id: string;
  on_edit: () => void;
}) {
  const { mutate: delete_relationship, isPending: is_deleting } = use_delete_relationship();
  const { mutate: update_relationship, isPending: is_linking } = use_update_relationship();

  function handle_link_suggestion() {
    if (!relationship.suggested_contact_id || !relationship.suggested_contact_name) return;
    update_relationship({
      id: relationship.id,
      contact_id,
      linked_contact_id: relationship.suggested_contact_id,
      person_name: relationship.suggested_contact_name,
      source: 'manual',
    });
  }

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
        {!relationship.linked_contact_id && relationship.suggested_contact_id && (
          <button
            onClick={handle_link_suggestion}
            disabled={is_linking}
            className="inline-flex items-center gap-1 shrink-0"
            title={`Link to ${relationship.suggested_contact_name}`}
          >
            <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/85 text-xs gap-1">
              {relationship.suggested_contact_name}
              <ArrowRight className="w-3 h-3" />
            </Badge>
          </button>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="icon-xs" variant="ghost" onClick={on_edit}>
          <Pencil className="w-3 h-3" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => delete_relationship({
            id: relationship.id,
            contact_id,
            linked_contact_id: relationship.linked_contact_id,
          })}
          disabled={is_deleting}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function RelationshipDialog({
  contact_id,
  open,
  on_open_change,
  relationship,
}: {
  contact_id: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
  relationship?: Relationship | null;
}) {
  const is_edit = !!relationship;

  function initial_label() {
    if (!relationship) return '';
    return COMMON_LABELS.includes(relationship.label) ? relationship.label : 'custom';
  }

  function initial_custom_label() {
    if (!relationship) return '';
    return COMMON_LABELS.includes(relationship.label) ? '' : relationship.label;
  }

  const [label, set_label] = useState(initial_label);
  const [custom_label, set_custom_label] = useState(initial_custom_label);
  const [person_name, set_person_name] = useState(relationship?.person_name ?? '');
  const [linked_contact_id, set_linked_contact_id] = useState<string | undefined>(
    relationship?.linked_contact_id ?? undefined
  );
  const [linked_contact_name, set_linked_contact_name] = useState(
    relationship?.linked_contact_name ?? ''
  );
  const [show_picker, set_show_picker] = useState(false);
  const { mutate: create_relationship, isPending: is_creating } = use_create_relationship();
  const { mutate: update_relationship, isPending: is_updating } = use_update_relationship();

  const is_pending = is_creating || is_updating;
  const effective_label = label === 'custom' ? custom_label : label;

  // Sync form state when the relationship prop changes (opening edit for a different item)
  const [prev_relationship_id, set_prev_relationship_id] = useState<string | null>(null);
  if ((relationship?.id ?? null) !== prev_relationship_id) {
    set_prev_relationship_id(relationship?.id ?? null);
    set_label(relationship ? (COMMON_LABELS.includes(relationship.label) ? relationship.label : 'custom') : '');
    set_custom_label(relationship ? (COMMON_LABELS.includes(relationship.label) ? '' : relationship.label) : '');
    set_person_name(relationship?.person_name ?? '');
    set_linked_contact_id(relationship?.linked_contact_id ?? undefined);
    set_linked_contact_name(relationship?.linked_contact_name ?? '');
  }

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

    if (is_edit) {
      update_relationship(
        {
          id: relationship.id,
          contact_id,
          label: effective_label,
          person_name,
          linked_contact_id: linked_contact_id ?? null,
          old_linked_contact_id: relationship.linked_contact_id,
        },
        {
          onSuccess: () => {
            on_open_change(false);
            reset();
          },
        }
      );
    } else {
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
  }
  
  const [inputValue, setInputValue] = useState('');

  // Sort categories alphabetically
  const sorted_categories = useMemo(() => {
    return Object.keys(RELATIONSHIP_CATEGORIES).sort().map(category => ({
      name: category,
      items: RELATIONSHIP_CATEGORIES[category].sort((a, b) => 
        format_label(a).localeCompare(format_label(b))
      )
    }));
  }, []);

  const filtered_categories = useMemo(() => {
    if (!inputValue) return sorted_categories;
    const lower = inputValue.toLowerCase();
    
    // Deep clone and filter
    return sorted_categories.map(cat => ({
      ...cat,
      items: cat.items.filter(item => 
        format_label(item).toLowerCase().includes(lower)
      )
    })).filter(cat => cat.items.length > 0);
  }, [sorted_categories, inputValue]);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { on_open_change(o); if (!o) reset(); }}>
        {!is_edit && (
          <DialogTrigger render={<Button size="icon-xs" variant="ghost" />}>
            <Plus className="w-4 h-4" />
          </DialogTrigger>
        )}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{is_edit ? 'Edit Relationship' : 'Add Relationship'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handle_submit} className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Relationship Type</label>
              <Combobox
                value={label ? { value: label, label: label === 'custom' ? 'Custom...' : format_label(label) } : null}
                onValueChange={(val) => {
                  if (typeof val === 'string') {
                    set_label(val);
                  } else if (val && typeof val === 'object' && 'value' in val) {
                    set_label(val.value);
                  }
                }}
                inputValue={inputValue}
                onInputValueChange={setInputValue}
              >
                <ComboboxInput placeholder="Select relationship type..." />
                <ComboboxContent>
                  <ComboboxList>
                    <ComboboxEmpty>No results found.</ComboboxEmpty>
                    {filtered_categories.map((category) => (
                      <ComboboxGroup key={category.name}>
                        <ComboboxLabel>{category.name}</ComboboxLabel>
                        {category.items.map((item) => (
                          <ComboboxItem key={item} value={item}>
                             {format_label(item)}
                             {label === item && <Check className="ml-auto w-4 h-4" />}
                          </ComboboxItem>
                        ))}
                      </ComboboxGroup>
                    ))}
                    <ComboboxGroup>
                      <ComboboxLabel>Other</ComboboxLabel>
                       <ComboboxItem value="custom">
                         Custom...
                         {label === 'custom' && <Check className="ml-auto w-4 h-4" />}
                       </ComboboxItem>
                    </ComboboxGroup>
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
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
              <Button type="submit" disabled={is_pending || !effective_label || !person_name}>
                {is_pending ? (is_edit ? 'Saving...' : 'Adding...') : (is_edit ? 'Save' : 'Add')}
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
          set_person_name(contact.display_name);
        }}
        exclude_id={contact_id}
        title="Link to Contact"
        description="Search for a contact to link this relationship to."
      />
    </>
  );
}
