'use client';

import { useState, useCallback } from 'react';
import { use_search } from '@/lib/hooks/use-search';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchFilters } from '@/components/search/search-filters';
import { SearchResults } from '@/components/search/search-results';
import { Search as SearchIcon, Sparkles } from 'lucide-react';
import { debounce } from '@/lib/utils';
import { AppLayout } from '@/components/layout/app-layout';

export default function SearchPage() {
  const [query, set_query] = useState('');
  const [mode, set_mode] = useState<'combined' | 'keyword' | 'semantic'>('combined');
  const [filters, set_filters] = useState<{ start_date?: string; end_date?: string }>({});
  const [active_types, set_active_types] = useState<string[]>([]);

  const { data, isLoading } = use_search(
    {
      query,
      mode,
      types: active_types.length ? active_types : undefined,
      filters,
    },
    {
      enabled: query.length >= 2,
    }
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debounced_search = useCallback(debounce((q: string) => set_query(q), 300), []);

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Search</h1>

        <div className="flex gap-4">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search contacts, messages, facts, notes..."
              onChange={(e) => debounced_search(e.target.value)}
              className="pl-10 h-12 text-lg"
              autoFocus
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant={mode === 'combined' ? 'default' : 'outline'}
              onClick={() => set_mode('combined')}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Smart
            </Button>
            <Button
              variant={mode === 'keyword' ? 'default' : 'outline'}
              onClick={() => set_mode('keyword')}
            >
              Keyword
            </Button>
            <Button
              variant={mode === 'semantic' ? 'default' : 'outline'}
              onClick={() => set_mode('semantic')}
            >
              Semantic
            </Button>
          </div>
        </div>

        <div className="flex gap-4 flex-wrap">
          <SearchFilters value={filters} onChange={set_filters} />

          <div className="flex gap-2">
            {['contacts', 'communications', 'facts', 'notes'].map((type) => (
              <Badge
                key={type}
                variant={active_types.includes(type) ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => {
                  set_active_types((prev) =>
                    prev.includes(type)
                      ? prev.filter((t) => t !== type)
                      : [...prev, type]
                  );
                }}
              >
                {type}
              </Badge>
            ))}
          </div>
        </div>

        {query.length >= 2 && (
          <SearchResults results={data?.results || []} is_loading={isLoading} />
        )}

        {query.length < 2 && (
          <div className="text-center py-12 text-muted-foreground">
            <SearchIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Enter at least 2 characters to search</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
