'use client';

import { useState } from 'react';
import { use_smart_lists, use_create_smart_list, use_delete_smart_list } from '@/lib/hooks/use-smart-lists';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Loader2, ListFilter } from 'lucide-react';

export function SmartListsSettings() {
  const { data, isLoading } = use_smart_lists();
  const { mutate: create_smart_list, isPending: is_creating } = use_create_smart_list();
  const { mutate: delete_smart_list } = use_delete_smart_list();

  const [new_list, set_new_list] = useState({ name: '', rules: '' });
  const [parse_error, set_parse_error] = useState<string | null>(null);

  function handle_create(e: React.FormEvent) {
    e.preventDefault();
    set_parse_error(null);

    let parsed_rules;
    try {
      parsed_rules = JSON.parse(new_list.rules);
    } catch {
      set_parse_error('Invalid JSON. Please check your rules syntax.');
      return;
    }

    create_smart_list(
      {
        name: new_list.name,
        rules: parsed_rules,
      },
      {
        onSuccess: () => set_new_list({ name: '', rules: '' }),
      }
    );
  }

  const smart_lists = data?.smart_lists || [];

  const example_rules = JSON.stringify(
    {
      operator: 'AND',
      conditions: [
        { field: 'tag', operator: 'contains', value: 'vip' },
        { field: 'last_contact_days', operator: 'greater_than', value: 30 },
      ],
    },
    null,
    2
  );

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">Smart Lists</h2>
        <p className="text-muted-foreground">
          Create dynamic lists based on rules. Contacts matching the rules will be automatically
          included.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handle_create} className="space-y-4">
          <Input
            placeholder="Smart list name"
            value={new_list.name}
            onChange={(e) => set_new_list((l) => ({ ...l, name: e.target.value }))}
            required
          />
          <div className="space-y-2">
            <Textarea
              placeholder="Rules (JSON format)"
              value={new_list.rules}
              onChange={(e) => set_new_list((l) => ({ ...l, rules: e.target.value }))}
              rows={6}
              className="font-mono text-sm"
              required
            />
            {parse_error && <p className="text-sm text-destructive">{parse_error}</p>}
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                Example rules format
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                {example_rules}
              </pre>
            </details>
          </div>
          <Button type="submit" disabled={is_creating}>
            {is_creating ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Create Smart List
          </Button>
        </form>

        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="space-y-2">
          {smart_lists.map((list) => (
            <div key={list.id} className="flex items-center justify-between p-2 border rounded">
              <div className="flex items-center gap-3">
                <ListFilter className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{list.name}</span>
                <Badge variant="secondary">{list.contact_count ?? 0} contacts</Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={() => delete_smart_list(list.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
