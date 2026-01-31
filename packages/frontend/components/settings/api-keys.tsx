'use client';

import { useState } from 'react';
import { use_api_keys, use_create_api_key, use_delete_api_key } from '@/lib/hooks/use-api-keys';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Loader2, Key, Copy, Check } from 'lucide-react';
import { format_date } from '@/lib/utils';

export function ApiKeysSettings() {
  const { data, isLoading } = use_api_keys();
  const { mutate: create_api_key, isPending: is_creating } = use_create_api_key();
  const { mutate: delete_api_key } = use_delete_api_key();

  const [new_key_name, set_new_key_name] = useState('');
  const [created_key, set_created_key] = useState<string | null>(null);
  const [copied, set_copied] = useState(false);

  function handle_create(e: React.FormEvent) {
    e.preventDefault();
    create_api_key(new_key_name, {
      onSuccess: (data) => {
        set_new_key_name('');
        set_created_key(data.key);
      },
    });
  }

  function handle_copy() {
    if (created_key) {
      navigator.clipboard.writeText(created_key);
      set_copied(true);
      setTimeout(() => set_copied(false), 2000);
    }
  }

  const api_keys = data?.api_keys || [];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">API Keys</h2>
        <p className="text-muted-foreground">
          Create API keys to access your data programmatically. Keep your keys secure.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {created_key && (
          <div className="p-4 border rounded bg-muted space-y-2">
            <p className="text-sm font-medium">Your new API key (copy it now, it won&apos;t be shown again):</p>
            <div className="flex gap-2">
              <code className="flex-1 p-2 bg-background rounded text-sm font-mono break-all">
                {created_key}
              </code>
              <Button variant="outline" size="sm" onClick={handle_copy}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => set_created_key(null)}>
              Dismiss
            </Button>
          </div>
        )}

        <form onSubmit={handle_create} className="flex gap-2">
          <Input
            placeholder="API key name (e.g., 'Development', 'Production')"
            value={new_key_name}
            onChange={(e) => set_new_key_name(e.target.value)}
            required
          />
          <Button type="submit" disabled={is_creating}>
            {is_creating ? (
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
          {api_keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between p-2 border rounded">
              <div className="flex items-center gap-3">
                <Key className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{key.name}</span>
                <span className="text-sm text-muted-foreground">
                  Created {format_date(key.created_at)}
                </span>
                {key.last_used_at && (
                  <span className="text-sm text-muted-foreground">
                    Last used {format_date(key.last_used_at)}
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => delete_api_key(key.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
