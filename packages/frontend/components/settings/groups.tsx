'use client';

import { useState } from 'react';
import { use_groups, use_create_group, use_delete_group } from '@/lib/hooks/use-groups';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Loader2, Folder } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export function GroupsSettings() {
  const { data, isLoading } = use_groups();
  const { mutate: create_group, isPending: is_creating } = use_create_group();
  const { mutate: delete_group } = use_delete_group();

  const [new_group, set_new_group] = useState({ name: '', parent_id: '', followup_days: '' });

  function handle_create(e: React.FormEvent) {
    e.preventDefault();
    create_group(
      {
        name: new_group.name,
        parent_id: new_group.parent_id || undefined,
        followup_days: new_group.followup_days ? parseInt(new_group.followup_days) : undefined,
      },
      {
        onSuccess: () => set_new_group({ name: '', parent_id: '', followup_days: '' }),
      }
    );
  }

  const groups = data?.groups || [];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">Groups</h2>
        <p className="text-muted-foreground">
          Organize contacts into hierarchical groups for better organization.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handle_create} className="flex gap-2">
          <Input
            placeholder="Group name"
            value={new_group.name}
            onChange={(e) => set_new_group((g) => ({ ...g, name: e.target.value }))}
            required
          />
          <Select
            value={new_group.parent_id}
            onValueChange={(value) => set_new_group((g) => ({ ...g, parent_id: value || '' }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Parent group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            placeholder="Follow-up days"
            value={new_group.followup_days}
            onChange={(e) => set_new_group((g) => ({ ...g, followup_days: e.target.value }))}
            className="w-32"
          />
          <Button type="submit" disabled={is_creating}>
            {is_creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </form>

        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="space-y-2">
          {groups.map((group) => {
            const parent = group.parent_id
              ? groups.find((g) => g.id === group.parent_id)
              : null;

            return (
              <div key={group.id} className="flex items-center justify-between p-2 border rounded">
                <div className="flex items-center gap-3">
                  <Folder className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{group.name}</span>
                  {parent && (
                    <span className="text-sm text-muted-foreground">in {parent.name}</span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {group.contact_count ?? 0} contacts
                  </span>
                  {group.followup_days && (
                    <Badge variant="secondary">{group.followup_days} day follow-up</Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => delete_group(group.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
