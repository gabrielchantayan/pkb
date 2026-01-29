# Feature: Frontend Advanced

## Overview

Build advanced frontend features: Global Search, AI Query interface, Settings page, and Relationship Graph visualization.

## Dependencies

- **Requires**: 13-frontend-core, 08-tags-organization, 09-search, 10-ai-integration

## Pages

### Search Page (`/search`)

Global search with filters and multiple result types.

```tsx
// app/search/page.tsx
'use client';

import { useState, useCallback } from 'react';
import { useSearch } from '@/lib/hooks/use-search';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchFilters } from '@/components/search/search-filters';
import { SearchResults } from '@/components/search/search-results';
import { Search as SearchIcon, Sparkles } from 'lucide-react';
import { debounce } from '@/lib/utils';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'combined' | 'keyword' | 'semantic'>('combined');
  const [filters, setFilters] = useState({});
  const [activeTypes, setActiveTypes] = useState<string[]>([]);

  const { data, isLoading, refetch } = useSearch({
    query,
    mode,
    types: activeTypes.length ? activeTypes : undefined,
    filters,
  }, {
    enabled: query.length >= 2,
  });

  const debouncedSearch = useCallback(
    debounce((q: string) => setQuery(q), 300),
    []
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Search</h1>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="Search contacts, messages, facts, notes..."
            onChange={(e) => debouncedSearch(e.target.value)}
            className="pl-10 h-12 text-lg"
            autoFocus
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant={mode === 'combined' ? 'default' : 'outline'}
            onClick={() => setMode('combined')}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Smart
          </Button>
          <Button
            variant={mode === 'keyword' ? 'default' : 'outline'}
            onClick={() => setMode('keyword')}
          >
            Keyword
          </Button>
          <Button
            variant={mode === 'semantic' ? 'default' : 'outline'}
            onClick={() => setMode('semantic')}
          >
            Semantic
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        <SearchFilters value={filters} onChange={setFilters} />

        <div className="flex gap-2">
          {['contacts', 'communications', 'facts', 'notes'].map(type => (
            <Badge
              key={type}
              variant={activeTypes.includes(type) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => {
                setActiveTypes(prev =>
                  prev.includes(type)
                    ? prev.filter(t => t !== type)
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
        <SearchResults results={data?.results || []} isLoading={isLoading} />
      )}

      {query.length < 2 && (
        <div className="text-center py-12 text-muted-foreground">
          <SearchIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Enter at least 2 characters to search</p>
        </div>
      )}
    </div>
  );
}
```

```tsx
// components/search/search-results.tsx
import Link from 'next/link';
import { SearchResult } from '@pkb/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/shared/avatar';
import { User, MessageSquare, FileText, StickyNote } from 'lucide-react';

const TYPE_ICONS = {
  contact: User,
  communication: MessageSquare,
  fact: FileText,
  note: StickyNote,
};

interface SearchResultsProps {
  results: SearchResult[];
  isLoading: boolean;
}

export function SearchResults({ results, isLoading }: SearchResultsProps) {
  if (isLoading) {
    return <div className="space-y-2">{/* Skeleton */}</div>;
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No results found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {results.map(result => {
        const Icon = TYPE_ICONS[result.type];
        const href = result.type === 'contact'
          ? `/contacts/${result.id}`
          : `/contacts/${result.contact?.id}`;

        return (
          <Link key={`${result.type}-${result.id}`} href={href}>
            <Card className="hover:bg-accent transition-colors">
              <CardContent className="flex items-start gap-4 py-4">
                <div className="p-2 bg-muted rounded">
                  <Icon className="w-5 h-5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline">{result.type}</Badge>
                    {result.contact && result.type !== 'contact' && (
                      <span className="text-sm text-muted-foreground">
                        {result.contact.displayName}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      Score: {(result.score * 100).toFixed(0)}%
                    </span>
                  </div>

                  {result.type === 'contact' && (
                    <p className="font-medium">{result.data.display_name}</p>
                  )}

                  {result.highlights?.map((highlight, i) => (
                    <p
                      key={i}
                      className="text-sm text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: highlight }}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
```

### AI Query Page (`/ai`)

Natural language query interface.

```tsx
// app/ai/page.tsx
'use client';

import { useState } from 'react';
import { useAiQuery } from '@/lib/hooks/use-ai';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import Link from 'next/link';

const EXAMPLE_QUERIES = [
  "When is John's birthday?",
  "Who works at Google?",
  "Find all mentions of travel plans",
  "Summarize my relationship with Sarah",
  "Who haven't I talked to in 3 months?",
  "What are my outstanding action items?",
];

export default function AiQueryPage() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data, isLoading, error } = useAiQuery(submitted, {
    enabled: !!submitted,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      setSubmitted(query.trim());
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="font-medium">AI-Powered Query</span>
        </div>
        <h1 className="text-3xl font-bold">Ask anything about your contacts</h1>
        <p className="text-muted-foreground">
          Use natural language to query your personal knowledge base
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          placeholder="Ask a question..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-12"
        />
        <Button type="submit" size="lg" disabled={isLoading || !query.trim()}>
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </Button>
      </form>

      {!submitted && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((q) => (
              <Button
                key={q}
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery(q);
                  setSubmitted(q);
                }}
              >
                {q}
              </Button>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <Card>
          <CardContent className="py-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Searching your knowledge base...</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-destructive">
            An error occurred while processing your query.
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="font-medium">Answer</span>
              <Badge variant="secondary" className="ml-auto">
                {Math.round(data.confidence * 100)}% confidence
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-lg">{data.answer}</p>

            {data.sources.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Sources:</p>
                <div className="space-y-2">
                  {data.sources.map((source) => (
                    <div
                      key={source.id}
                      className="flex items-center gap-2 text-sm p-2 bg-muted rounded"
                    >
                      <Badge variant="outline">{source.type}</Badge>
                      <span className="text-muted-foreground truncate">
                        {source.snippet}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

### Settings Page (`/settings`)

User settings and configuration.

```tsx
// app/settings/page.tsx
'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileSettings } from '@/components/settings/profile';
import { TagsSettings } from '@/components/settings/tags';
import { GroupsSettings } from '@/components/settings/groups';
import { SmartListsSettings } from '@/components/settings/smart-lists';
import { ApiKeysSettings } from '@/components/settings/api-keys';
import { BlocklistSettings } from '@/components/settings/blocklist';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="smart-lists">Smart Lists</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="blocklist">Blocklist</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="tags">
          <TagsSettings />
        </TabsContent>

        <TabsContent value="groups">
          <GroupsSettings />
        </TabsContent>

        <TabsContent value="smart-lists">
          <SmartListsSettings />
        </TabsContent>

        <TabsContent value="api-keys">
          <ApiKeysSettings />
        </TabsContent>

        <TabsContent value="blocklist">
          <BlocklistSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

```tsx
// components/settings/tags.tsx
'use client';

import { useState } from 'react';
import { useTags, useCreateTag, useDeleteTag } from '@/lib/hooks/use-tags';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';

export function TagsSettings() {
  const { data: tags } = useTags();
  const { mutate: createTag } = useCreateTag();
  const { mutate: deleteTag } = useDeleteTag();

  const [newTag, setNewTag] = useState({ name: '', color: '#808080', followup_days: '' });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createTag({
      name: newTag.name,
      color: newTag.color,
      followup_days: newTag.followup_days ? parseInt(newTag.followup_days) : undefined,
    });
    setNewTag({ name: '', color: '#808080', followup_days: '' });
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">Tags</h2>
        <p className="text-muted-foreground">
          Organize contacts with tags. Set follow-up thresholds to get reminded when you haven't contacted someone.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input
            placeholder="Tag name"
            value={newTag.name}
            onChange={(e) => setNewTag(n => ({ ...n, name: e.target.value }))}
            required
          />
          <Input
            type="color"
            value={newTag.color}
            onChange={(e) => setNewTag(n => ({ ...n, color: e.target.value }))}
            className="w-16"
          />
          <Input
            type="number"
            placeholder="Follow-up days"
            value={newTag.followup_days}
            onChange={(e) => setNewTag(n => ({ ...n, followup_days: e.target.value }))}
            className="w-32"
          />
          <Button type="submit">
            <Plus className="w-4 h-4" />
          </Button>
        </form>

        <div className="space-y-2">
          {tags?.map(tag => (
            <div key={tag.id} className="flex items-center justify-between p-2 border rounded">
              <div className="flex items-center gap-3">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="font-medium">{tag.name}</span>
                <span className="text-sm text-muted-foreground">
                  {tag.contact_count} contacts
                </span>
                {tag.followup_days && (
                  <Badge variant="secondary">
                    {tag.followup_days} day follow-up
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteTag(tag.id)}
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
```

### Relationship Graph (`/graph`)

Visual graph of contact relationships.

```tsx
// app/graph/page.tsx
'use client';

import { useEffect, useRef } from 'react';
import { useRelationshipGraph } from '@/lib/hooks/use-relationships';
import { Card } from '@/components/ui/card';
import ForceGraph2D from 'react-force-graph-2d';

export default function GraphPage() {
  const graphRef = useRef<any>();
  const { data, isLoading } = useRelationshipGraph();

  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.d3Force('charge').strength(-300);
    }
  }, [data]);

  if (isLoading) {
    return <div>Loading graph...</div>;
  }

  const graphData = {
    nodes: data?.contacts.map(c => ({
      id: c.id,
      name: c.displayName,
      val: c.engagementScore || 1,
      color: c.starred ? '#fbbf24' : '#6b7280',
    })) || [],
    links: data?.relationships.map(r => ({
      source: r.contact_a_id,
      target: r.contact_b_id,
      value: r.strength || 1,
    })) || [],
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Relationship Graph</h1>

      <Card className="h-[calc(100vh-200px)]">
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          nodeLabel="name"
          nodeRelSize={6}
          nodeVal={node => node.val}
          nodeColor={node => node.color}
          linkWidth={link => Math.sqrt(link.value)}
          linkColor={() => '#e5e7eb'}
          onNodeClick={(node) => {
            window.location.href = `/contacts/${node.id}`;
          }}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const label = node.name;
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = node.color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.val, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#000';
            ctx.fillText(label, node.x, node.y + node.val + fontSize);
          }}
        />
      </Card>
    </div>
  );
}
```

## Additional Hooks

```typescript
// lib/hooks/use-search.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

interface SearchParams {
  query: string;
  mode?: 'keyword' | 'semantic' | 'combined';
  types?: string[];
  filters?: object;
}

export function useSearch(params: SearchParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['search', params],
    queryFn: () => api.search(params),
    enabled: options?.enabled ?? true,
  });
}

// lib/hooks/use-ai.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function useAiQuery(query: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['ai-query', query],
    queryFn: () => api.aiQuery(query),
    enabled: options?.enabled ?? true,
    staleTime: Infinity, // AI responses don't need refresh
  });
}

// lib/hooks/use-tags.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.getTags(),
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.createTag(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  });
}

// lib/hooks/use-relationships.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function useRelationshipGraph() {
  return useQuery({
    queryKey: ['relationship-graph'],
    queryFn: () => api.getRelationshipGraph(),
  });
}
```

## API Client Additions

```typescript
// lib/api.ts additions

// Search
search(params: { query: string; mode?: string; types?: string[]; filters?: object }) {
  return this.fetch('/api/search', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// AI
aiQuery(query: string, contactId?: string) {
  return this.fetch('/api/ai/query', {
    method: 'POST',
    body: JSON.stringify({ query, contact_id: contactId }),
  });
}

// Tags
getTags() {
  return this.fetch('/api/tags');
}

createTag(data: { name: string; color?: string; followup_days?: number }) {
  return this.fetch('/api/tags', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

deleteTag(id: string) {
  return this.fetch(`/api/tags/${id}`, { method: 'DELETE' });
}

// Groups
getGroups() {
  return this.fetch('/api/groups');
}

createGroup(data: { name: string; parent_id?: string; followup_days?: number }) {
  return this.fetch('/api/groups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Smart Lists
getSmartLists() {
  return this.fetch('/api/smartlists');
}

createSmartList(data: { name: string; rules: object }) {
  return this.fetch('/api/smartlists', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// API Keys
getApiKeys() {
  return this.fetch('/api/auth/api-keys');
}

createApiKey(name: string) {
  return this.fetch('/api/auth/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

deleteApiKey(id: string) {
  return this.fetch(`/api/auth/api-keys/${id}`, { method: 'DELETE' });
}

// Relationship Graph
getRelationshipGraph() {
  return this.fetch('/api/relationships/graph');
}
```

## Implementation Steps

1. Install `react-force-graph-2d` for graph visualization
2. Create search page with filters and result rendering
3. Create AI query page with example queries
4. Create settings page with all tabs
5. Implement tags management UI
6. Implement groups management with hierarchy display
7. Implement smart lists builder UI
8. Implement API keys management
9. Implement blocklist management
10. Create relationship graph page
11. Add API client methods for all new endpoints
12. Test all pages and interactions

## Acceptance Criteria

- [ ] Search page supports keyword, semantic, and combined modes
- [ ] Search results show highlights and scores
- [ ] Search filters by type, date, contact, tags
- [ ] AI query page shows example queries
- [ ] AI responses include source citations
- [ ] Settings page manages tags with colors and thresholds
- [ ] Settings page manages hierarchical groups
- [ ] Settings page manages smart list rules
- [ ] Settings page shows API keys (create/delete)
- [ ] Relationship graph renders contact network
- [ ] Graph nodes sized by engagement score
- [ ] Graph nodes clickable to navigate to contact

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/frontend/app/search/page.tsx` | Search page |
| `packages/frontend/app/ai/page.tsx` | AI query page |
| `packages/frontend/app/settings/page.tsx` | Settings page |
| `packages/frontend/app/graph/page.tsx` | Relationship graph |
| `packages/frontend/components/search/*` | Search components |
| `packages/frontend/components/settings/*` | Settings components |
| `packages/frontend/lib/hooks/use-search.ts` | Search hook |
| `packages/frontend/lib/hooks/use-ai.ts` | AI query hook |
| `packages/frontend/lib/hooks/use-tags.ts` | Tags hooks |
| `packages/frontend/lib/hooks/use-relationships.ts` | Graph hook |

## Notes for Implementation

- react-force-graph-2d uses WebGL, may need fallback
- Smart list rule builder is complex - consider JSON editor initially
- API key display shows key only once at creation
- Graph performance degrades with many nodes - consider filtering
- Search debouncing prevents excessive API calls
- AI query caching with staleTime: Infinity avoids re-fetching
