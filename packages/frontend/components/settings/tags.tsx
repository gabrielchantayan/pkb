'use client';

import { useState } from 'react';
import { use_tags, use_create_tag, use_delete_tag } from '@/lib/hooks/use-tags';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Loader2 } from 'lucide-react';

export function TagsSettings() {
  const { data, isLoading } = use_tags();
  const { mutate: create_tag, isPending: is_creating } = use_create_tag();
  const { mutate: delete_tag } = use_delete_tag();

  const [new_tag, set_new_tag] = useState({ name: '', color: '#808080', followup_days: '' });

  function handle_create(e: React.FormEvent) {
    e.preventDefault();
    create_tag(
      {
        name: new_tag.name,
        color: new_tag.color,
        followup_days: new_tag.followup_days ? parseInt(new_tag.followup_days) : undefined,
      },
      {
        onSuccess: () => set_new_tag({ name: '', color: '#808080', followup_days: '' }),
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">Tags</h2>
        <p className="text-muted-foreground">
          Organize contacts with tags. Set follow-up thresholds to get reminded when you
          haven&apos;t contacted someone.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handle_create} className="flex gap-2">
          <Input
            placeholder="Tag name"
            value={new_tag.name}
            onChange={(e) => set_new_tag((n) => ({ ...n, name: e.target.value }))}
            required
          />
          <Input
            type="color"
            value={new_tag.color}
            onChange={(e) => set_new_tag((n) => ({ ...n, color: e.target.value }))}
            className="w-16"
          />
          <Input
            type="number"
            placeholder="Follow-up days"
            value={new_tag.followup_days}
            onChange={(e) => set_new_tag((n) => ({ ...n, followup_days: e.target.value }))}
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
          {data?.tags?.map((tag) => (
            <div key={tag.id} className="flex items-center justify-between p-2 border rounded">
              <div className="flex items-center gap-3">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: tag.color || '#808080' }}
                />
                <span className="font-medium">{tag.name}</span>
                <span className="text-sm text-muted-foreground">
                  {tag.contact_count ?? 0} contacts
                </span>
                {tag.followup_days && (
                  <Badge variant="secondary">{tag.followup_days} day follow-up</Badge>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => delete_tag(tag.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
