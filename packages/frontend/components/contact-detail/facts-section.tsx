'use client';

import { useState } from 'react';
import { Fact } from '@/lib/api';
import { useCreateFact, useDeleteFact } from '@/lib/hooks/use-facts';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
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
import { Plus, Trash2, Sparkles } from 'lucide-react';

interface FactsSectionProps {
  contact_id: string;
  facts: Fact[];
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

const CATEGORY_LABELS: Record<string, string> = {
  basic_info: 'Basic Info',
  preference: 'Preferences & Interests',
  custom: 'Custom',
};

// Order categories should appear
const CATEGORY_ORDER = ['basic_info', 'preference', 'custom'];

export function FactsSection({ contact_id, facts }: FactsSectionProps) {
  const [show_form, set_show_form] = useState(false);

  // Group facts by category
  const grouped = facts.reduce(
    (acc, fact) => {
      const cat = fact.category || 'custom';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(fact);
      return acc;
    },
    {} as Record<string, Fact[]>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Facts</CardTitle>
        <AddFactDialog
          contact_id={contact_id}
          open={show_form}
          on_open_change={set_show_form}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {CATEGORY_ORDER
          .filter((cat) => grouped[cat]?.length > 0)
          .concat(Object.keys(grouped).filter((k) => !CATEGORY_ORDER.includes(k)))
          .filter((cat) => grouped[cat]?.length > 0)
          .map((category) => (
            <div key={category}>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                {CATEGORY_LABELS[category] || category.replace('_', ' ')}
              </h3>
              <div className="space-y-1">
                {grouped[category].map((fact) => (
                  <FactItem key={fact.id} fact={fact} contact_id={contact_id} />
                ))}
              </div>
            </div>
          ))}

        {facts.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">
            No facts recorded yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FactItem({ fact, contact_id }: { fact: Fact; contact_id: string }) {
  const { mutate: delete_fact, isPending } = useDeleteFact();

  return (
    <div className="flex items-center justify-between py-1.5 group">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium">{FACT_TYPE_LABELS[fact.fact_type] || fact.fact_type}:</span>
        <span className="text-sm truncate">{fact.value}</span>
        {fact.has_conflict && (
          <Badge variant="destructive" className="text-xs">
            Conflict
          </Badge>
        )}
        {fact.source === 'extracted' && (
          <span title="AI extracted">
            <Sparkles className="w-3 h-3 text-purple-500" />
          </span>
        )}
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => delete_fact({ id: fact.id, contact_id })}
        disabled={isPending}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

function AddFactDialog({
  contact_id,
  open,
  on_open_change,
}: {
  contact_id: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
}) {
  const [fact_type, set_fact_type] = useState('');
  const [value, set_value] = useState('');
  const { mutate: create_fact, isPending } = useCreateFact();

  function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    create_fact(
      { contact_id, fact_type, value },
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
