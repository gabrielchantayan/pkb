'use client';

import { useState, useCallback } from 'react';
import { Fact } from '@/lib/api';
import { useCreateFact, useDeleteFact, useBulkDeleteFacts } from '@/lib/hooks/use-facts';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Plus, Trash2, Sparkles, CheckSquare, X } from 'lucide-react';

interface FactsSectionProps {
  contact_id: string;
  facts: Fact[];
  variant?: 'sidebar' | 'grid';
}

const FACT_TYPE_LABELS: Record<string, string> = {
  birthday: 'Birthday',
  location: 'Location',
  job_title: 'Job Title',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  preference: 'Preference',
  tool: 'Tool',
  hobby: 'Hobby',
  opinion: 'Opinion',
  life_event: 'Life Event',
  goal: 'Goal',
  custom: 'Custom',
};

export function FactsSection({ contact_id, facts, variant = 'grid' }: FactsSectionProps) {
  const [show_form, set_show_form] = useState(false);
  const [selecting, set_selecting] = useState(false);
  const [selected_ids, set_selected_ids] = useState<Set<string>>(new Set());
  const { mutate: bulk_delete, isPending: is_bulk_deleting } = useBulkDeleteFacts();

  const filtered_facts = facts.filter(fact => {
    const is_basic = fact.category === 'basic_info';
    return variant === 'sidebar' ? is_basic : !is_basic;
  });

  const toggle_select = useCallback((id: string) => {
    set_selected_ids(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggle_select_all = useCallback(() => {
    set_selected_ids(prev =>
      prev.size === filtered_facts.length
        ? new Set()
        : new Set(filtered_facts.map(f => f.id))
    );
  }, [filtered_facts]);

  function exit_select_mode() {
    set_selecting(false);
    set_selected_ids(new Set());
  }

  function handle_bulk_delete() {
    if (selected_ids.size === 0) return;
    bulk_delete(
      { ids: Array.from(selected_ids), contact_id },
      { onSuccess: exit_select_mode }
    );
  }

  const select_toggle_button = (
    <Button
      size="icon-xs"
      variant={selecting ? 'secondary' : 'ghost'}
      onClick={selecting ? exit_select_mode : () => set_selecting(true)}
      title={selecting ? 'Exit select mode' : 'Select facts'}
    >
      {selecting ? <X className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
    </Button>
  );

  const selection_toolbar = selecting && filtered_facts.length > 0 && (
    <div className="flex items-center gap-2 text-sm">
      <Button size="xs" variant="ghost" onClick={toggle_select_all}>
        {selected_ids.size === filtered_facts.length ? 'Deselect all' : 'Select all'}
      </Button>
      <span className="text-muted-foreground">
        {selected_ids.size} selected
      </span>
      {selected_ids.size > 0 && (
        <Button
          size="xs"
          variant="destructive"
          onClick={handle_bulk_delete}
          disabled={is_bulk_deleting}
        >
          <Trash2 className="w-3 h-3 mr-1" />
          {is_bulk_deleting ? 'Deleting...' : 'Delete selected'}
        </Button>
      )}
    </div>
  );

  if (variant === 'sidebar') {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 pt-3">
          <h3 className="text-lg font-semibold">Basic Info</h3>
          <div className="flex items-center gap-1">
            {filtered_facts.length > 0 && select_toggle_button}
            {!selecting && (
              <AddFactDialog
                contact_id={contact_id}
                open={show_form}
                on_open_change={set_show_form}
                default_category="basic_info"
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          {selection_toolbar}
          {filtered_facts.map((fact) => (
            <FactItem
              key={fact.id}
              fact={fact}
              contact_id={contact_id}
              selecting={selecting}
              selected={selected_ids.has(fact.id)}
              on_toggle={() => toggle_select(fact.id)}
            />
          ))}
          {filtered_facts.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-2">
              No basic info
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Grid variant
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Facts</h2>
        <div className="flex items-center gap-1">
          {filtered_facts.length > 0 && select_toggle_button}
          {!selecting && (
            <AddFactDialog
              contact_id={contact_id}
              open={show_form}
              on_open_change={set_show_form}
            />
          )}
        </div>
      </div>

      {selection_toolbar}

      <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
        {filtered_facts.map((fact) => (
          <div key={fact.id} className="break-inside-avoid mb-4">
             <Card>
               <CardContent className="p-3">
                 <FactItem
                   fact={fact}
                   contact_id={contact_id}
                   selecting={selecting}
                   selected={selected_ids.has(fact.id)}
                   on_toggle={() => toggle_select(fact.id)}
                 />
               </CardContent>
             </Card>
          </div>
        ))}
      </div>

      {filtered_facts.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground text-sm border-dashed">
          No other facts recorded yet
        </Card>
      )}
    </div>
  );
}

function FactItem({
  fact,
  contact_id,
  selecting,
  selected,
  on_toggle,
}: {
  fact: Fact;
  contact_id: string;
  selecting: boolean;
  selected: boolean;
  on_toggle: () => void;
}) {
  const { mutate: delete_fact, isPending } = useDeleteFact();

  return (
    <div className="flex items-start justify-between group gap-2">
      {selecting && (
        <input
          type="checkbox"
          checked={selected}
          onChange={on_toggle}
          className="mt-1.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-primary cursor-pointer"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary" className="text-[10px] px-1.5 h-5 font-normal">
            {FACT_TYPE_LABELS[fact.fact_type] || fact.fact_type}
          </Badge>
          {fact.has_conflict && (
            <Badge variant="destructive" className="text-[10px] px-1 h-5">
              Conflict
            </Badge>
          )}
          {fact.source === 'extracted' && (
            <span title="AI extracted">
              <Sparkles className="w-3 h-3 text-purple-500" />
            </span>
          )}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words">{fact.value}</div>
      </div>
      {!selecting && (
        <Button
          size="icon-xs"
          variant="ghost"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mt-1 -mr-1"
          onClick={() => delete_fact({ id: fact.id, contact_id })}
          disabled={isPending}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

function AddFactDialog({
  contact_id,
  open,
  on_open_change,
  default_category
  }: {
  contact_id: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
  default_category?: string;
}) {
  const [fact_type, set_fact_type] = useState('');
  const [value, set_value] = useState('');
  const { mutate: create_fact, isPending } = useCreateFact();

  function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    create_fact(
      { contact_id, fact_type, value, category: default_category },
      {
        onSuccess: () => {
          on_open_change(false);
          set_fact_type('');
          set_value('');
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={on_open_change}>
      <DialogTrigger render={<Button size="icon-xs" variant="ghost" />}>
        <Plus className="w-4 h-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Fact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handle_submit} className="space-y-4">
          <div>
            <Select value={fact_type} onValueChange={(val) => val && set_fact_type(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Fact type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FACT_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Input
              placeholder="Value"
              value={value}
              onChange={(e) => set_value(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => on_open_change(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !fact_type || !value}>
              {isPending ? 'Adding...' : 'Add Fact'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
