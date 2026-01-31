'use client';

import { useState } from 'react';
import { use_blocklist, use_add_to_blocklist, use_remove_from_blocklist } from '@/lib/hooks/use-blocklist';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Loader2, Ban } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { format_date } from '@/lib/utils';

export function BlocklistSettings() {
  const { data, isLoading } = use_blocklist();
  const { mutate: add_to_blocklist, isPending: is_adding } = use_add_to_blocklist();
  const { mutate: remove_from_blocklist } = use_remove_from_blocklist();

  const [new_entry, set_new_entry] = useState({ identifier: '', identifier_type: 'email' });

  function handle_add(e: React.FormEvent) {
    e.preventDefault();
    add_to_blocklist(
      {
        identifier: new_entry.identifier,
        identifier_type: new_entry.identifier_type,
      },
      {
        onSuccess: () => set_new_entry({ identifier: '', identifier_type: 'email' }),
      }
    );
  }

  const blocked = data?.blocked_identifiers || [];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">Blocklist</h2>
        <p className="text-muted-foreground">
          Block specific email addresses or phone numbers from being synced or associated with
          contacts.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handle_add} className="flex gap-2">
          <Select
            value={new_entry.identifier_type}
            onValueChange={(value) => set_new_entry((e) => ({ ...e, identifier_type: value || 'email' }))}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="phone">Phone</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder={
              new_entry.identifier_type === 'email' ? 'email@example.com' : '+1234567890'
            }
            value={new_entry.identifier}
            onChange={(e) => set_new_entry((entry) => ({ ...entry, identifier: e.target.value }))}
            required
          />
          <Button type="submit" disabled={is_adding}>
            {is_adding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </Button>
        </form>

        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="space-y-2">
          {blocked.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between p-2 border rounded">
              <div className="flex items-center gap-3">
                <Ban className="w-4 h-4 text-destructive" />
                <Badge variant="outline">{entry.identifier_type}</Badge>
                <span className="font-mono">{entry.identifier}</span>
                <span className="text-sm text-muted-foreground">
                  Added {format_date(entry.created_at)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove_from_blocklist(entry.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
