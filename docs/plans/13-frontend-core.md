# Feature: Frontend Core

## Overview

Build the core frontend pages: Dashboard, Contact List, and Contact Detail. Uses Next.js App Router with shadcn/ui components and React Query for data fetching.

## Dependencies

- **Requires**: 01-project-foundation (monorepo), 02-authentication, 03-contacts-core, 04-communications, 05-facts-system, 06-notes, 07-followups
- **Blocks**: 14-frontend-advanced

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Routing | Next.js App Router | Already scaffolded |
| UI Components | shadcn/ui | Specified in SPEC |
| State Management | React Query | Server state caching |
| Forms | React Hook Form + Zod | Type-safe validation |
| Styling | Tailwind CSS | Part of shadcn setup |

## Directory Structure

```
packages/frontend/
├── app/
│   ├── layout.tsx              # Root layout with providers
│   ├── page.tsx                # Dashboard (/)
│   ├── login/
│   │   └── page.tsx            # Login page
│   ├── contacts/
│   │   ├── page.tsx            # Contact list
│   │   └── [id]/
│   │       └── page.tsx        # Contact detail
│   └── api/                    # API route handlers (if needed)
├── components/
│   ├── ui/                     # shadcn components
│   ├── layout/
│   │   ├── header.tsx
│   │   ├── sidebar.tsx
│   │   └── nav.tsx
│   ├── dashboard/
│   │   ├── followup-list.tsx
│   │   ├── recent-activity.tsx
│   │   └── stats-cards.tsx
│   ├── contacts/
│   │   ├── contact-card.tsx
│   │   ├── contact-list.tsx
│   │   ├── contact-filters.tsx
│   │   └── contact-form.tsx
│   ├── contact-detail/
│   │   ├── header.tsx
│   │   ├── facts-section.tsx
│   │   ├── timeline.tsx
│   │   ├── notes-section.tsx
│   │   └── followups-section.tsx
│   └── shared/
│       ├── avatar.tsx
│       ├── loading.tsx
│       └── empty-state.tsx
├── lib/
│   ├── api.ts                  # API client
│   ├── auth.ts                 # Auth utilities
│   ├── hooks/
│   │   ├── use-contacts.ts
│   │   ├── use-contact.ts
│   │   ├── use-followups.ts
│   │   └── use-dashboard.ts
│   └── utils.ts
├── types/
│   └── index.ts                # Re-export from @pkb/shared
└── providers/
    ├── query-provider.tsx
    └── auth-provider.tsx
```

## Pages

### Login Page (`/login`)

Simple password login form.

```tsx
// app/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useAuth } from '@/providers/auth-provider';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-bold">Personal Knowledge Base</h1>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Dashboard (`/`)

Overview with follow-ups, recent activity, and stats.

```tsx
// app/page.tsx
import { FollowupList } from '@/components/dashboard/followup-list';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { StatsCards } from '@/components/dashboard/stats-cards';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <StatsCards />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FollowupList />
        <RecentActivity />
      </div>
    </div>
  );
}
```

```tsx
// components/dashboard/followup-list.tsx
'use client';

import { usePendingFollowups } from '@/lib/hooks/use-followups';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/shared/avatar';
import { formatRelativeDate } from '@/lib/utils';

export function FollowupList() {
  const { data, isLoading } = usePendingFollowups();

  if (isLoading) return <Card><CardContent>Loading...</CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">Follow-ups</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        {data?.overdue.length > 0 && (
          <div>
            <Badge variant="destructive" className="mb-2">Overdue</Badge>
            {data.overdue.map(followup => (
              <FollowupItem key={followup.id} followup={followup} />
            ))}
          </div>
        )}

        {data?.today.length > 0 && (
          <div>
            <Badge className="mb-2">Today</Badge>
            {data.today.map(followup => (
              <FollowupItem key={followup.id} followup={followup} />
            ))}
          </div>
        )}

        {data?.upcoming.length > 0 && (
          <div>
            <Badge variant="secondary" className="mb-2">Upcoming</Badge>
            {data.upcoming.map(followup => (
              <FollowupItem key={followup.id} followup={followup} />
            ))}
          </div>
        )}

        {!data?.overdue.length && !data?.today.length && !data?.upcoming.length && (
          <p className="text-muted-foreground">No pending follow-ups</p>
        )}
      </CardContent>
    </Card>
  );
}

function FollowupItem({ followup }: { followup: Followup }) {
  const { mutate: complete } = useCompleteFollowup();

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex items-center gap-3">
        <Avatar name={followup.contact_name} url={followup.contact_photo} size="sm" />
        <div>
          <p className="font-medium">{followup.contact_name}</p>
          <p className="text-sm text-muted-foreground">{followup.reason}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {formatRelativeDate(followup.due_date)}
        </span>
        <Button size="sm" variant="ghost" onClick={() => complete(followup.id)}>
          Done
        </Button>
      </div>
    </div>
  );
}
```

### Contact List (`/contacts`)

Searchable, filterable list of contacts.

```tsx
// app/contacts/page.tsx
'use client';

import { useState } from 'react';
import { useContacts } from '@/lib/hooks/use-contacts';
import { ContactList } from '@/components/contacts/contact-list';
import { ContactFilters } from '@/components/contacts/contact-filters';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Search } from 'lucide-react';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});

  const { data, isLoading, fetchNextPage, hasNextPage } = useContacts({
    search,
    ...filters
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Contacts</h1>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Contact
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <ContactFilters value={filters} onChange={setFilters} />
      </div>

      <ContactList
        contacts={data?.pages.flatMap(p => p.contacts) || []}
        isLoading={isLoading}
      />

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => fetchNextPage()}>
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
```

```tsx
// components/contacts/contact-list.tsx
import Link from 'next/link';
import { Contact } from '@pkb/shared';
import { Avatar } from '@/components/shared/avatar';
import { Badge } from '@/components/ui/badge';
import { Star } from 'lucide-react';

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
}

export function ContactList({ contacts, isLoading }: ContactListProps) {
  if (isLoading) {
    return <div className="space-y-2">{/* Skeleton loaders */}</div>;
  }

  if (contacts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No contacts found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {contacts.map(contact => (
        <Link
          key={contact.id}
          href={`/contacts/${contact.id}`}
          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
        >
          <Avatar name={contact.displayName} url={contact.photoUrl} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{contact.displayName}</span>
              {contact.starred && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
            </div>
            {contact.emails?.[0] && (
              <span className="text-sm text-muted-foreground truncate block">
                {contact.emails[0]}
              </span>
            )}
          </div>

          <div className="flex gap-1">
            {contact.tags?.slice(0, 3).map(tag => (
              <Badge key={tag.id} variant="secondary" style={{ backgroundColor: tag.color }}>
                {tag.name}
              </Badge>
            ))}
          </div>
        </Link>
      ))}
    </div>
  );
}
```

### Contact Detail (`/contacts/[id]`)

Full contact view with facts, timeline, notes, and follow-ups.

```tsx
// app/contacts/[id]/page.tsx
'use client';

import { useParams } from 'next/navigation';
import { useContact } from '@/lib/hooks/use-contact';
import { ContactHeader } from '@/components/contact-detail/header';
import { FactsSection } from '@/components/contact-detail/facts-section';
import { Timeline } from '@/components/contact-detail/timeline';
import { NotesSection } from '@/components/contact-detail/notes-section';
import { FollowupsSection } from '@/components/contact-detail/followups-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ContactDetailPage() {
  const { id } = useParams();
  const { data, isLoading } = useContact(id as string);

  if (isLoading) return <div>Loading...</div>;
  if (!data) return <div>Contact not found</div>;

  const { contact, identifiers, facts, recentCommunications, tags, groups } = data;

  return (
    <div className="space-y-6">
      <ContactHeader
        contact={contact}
        identifiers={identifiers}
        tags={tags}
        groups={groups}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <FactsSection contactId={contact.id} facts={facts} />
          <FollowupsSection contactId={contact.id} />
        </div>

        <div className="lg:col-span-2">
          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline">
              <Timeline contactId={contact.id} initial={recentCommunications} />
            </TabsContent>

            <TabsContent value="notes">
              <NotesSection contactId={contact.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// components/contact-detail/facts-section.tsx
'use client';

import { useState } from 'react';
import { Fact } from '@pkb/shared';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useCreateFact, useDeleteFact } from '@/lib/hooks/use-facts';
import { FactForm } from './fact-form';

interface FactsSectionProps {
  contactId: string;
  facts: Fact[];
}

export function FactsSection({ contactId, facts }: FactsSectionProps) {
  const [showForm, setShowForm] = useState(false);

  // Group facts by category
  const grouped = facts.reduce((acc, fact) => {
    const cat = fact.category || 'custom';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(fact);
    return acc;
  }, {} as Record<string, Fact[]>);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <h2 className="text-lg font-semibold">Facts</h2>
        <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(grouped).map(([category, categoryFacts]) => (
          <div key={category}>
            <h3 className="text-sm font-medium text-muted-foreground mb-2 capitalize">
              {category.replace('_', ' ')}
            </h3>
            <div className="space-y-2">
              {categoryFacts.map(fact => (
                <FactItem key={fact.id} fact={fact} />
              ))}
            </div>
          </div>
        ))}

        {facts.length === 0 && (
          <p className="text-muted-foreground text-sm">No facts yet</p>
        )}

        {showForm && (
          <FactForm
            contactId={contactId}
            onClose={() => setShowForm(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function FactItem({ fact }: { fact: Fact }) {
  const { mutate: deleteFact } = useDeleteFact();

  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <span className="text-sm font-medium">{fact.fact_type}: </span>
        <span className="text-sm">{fact.value}</span>
        {fact.has_conflict && (
          <Badge variant="destructive" className="ml-2">Conflict</Badge>
        )}
        {fact.source === 'extracted' && (
          <Badge variant="secondary" className="ml-2">AI</Badge>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => deleteFact(fact.id)}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}
```

```tsx
// components/contact-detail/timeline.tsx
'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Communication } from '@pkb/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import { api } from '@/lib/api';

interface TimelineProps {
  contactId: string;
  initial: Communication[];
}

export function Timeline({ contactId, initial }: TimelineProps) {
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['communications', contactId],
    queryFn: ({ pageParam }) => api.getCommunications({ contactId, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialData: { pages: [{ communications: initial, nextCursor: null }], pageParams: [undefined] }
  });

  const communications = data?.pages.flatMap(p => p.communications) || [];

  return (
    <Card>
      <CardContent className="divide-y">
        {communications.map(comm => (
          <div key={comm.id} className="py-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={comm.direction === 'inbound' ? 'default' : 'secondary'}>
                {comm.direction === 'inbound' ? 'Received' : 'Sent'}
              </Badge>
              <Badge variant="outline">{comm.source}</Badge>
              <span className="text-sm text-muted-foreground ml-auto">
                {formatDateTime(comm.timestamp)}
              </span>
            </div>

            {comm.subject && (
              <h4 className="font-medium mb-1">{comm.subject}</h4>
            )}

            <p className="text-sm whitespace-pre-wrap">
              {comm.content.length > 500
                ? comm.content.slice(0, 500) + '...'
                : comm.content}
            </p>
          </div>
        ))}

        {hasNextPage && (
          <div className="py-4 flex justify-center">
            <Button variant="outline" onClick={() => fetchNextPage()}>
              Load More
            </Button>
          </div>
        )}

        {communications.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            No communications yet
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

## API Client

```typescript
// lib/api.ts
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...options.headers,
      },
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401) {
        // Redirect to login
        window.location.href = '/login';
      }
      throw new Error(`API error: ${res.status}`);
    }

    return res.json();
  }

  // Auth
  login(email: string, password: string) {
    return this.fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  logout() {
    return this.fetch('/api/auth/logout', { method: 'POST' });
  }

  getMe() {
    return this.fetch('/api/auth/me');
  }

  // Dashboard
  getDashboard() {
    return this.fetch('/api/dashboard');
  }

  // Contacts
  getContacts(params: { search?: string; cursor?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.limit) query.set('limit', String(params.limit));
    return this.fetch(`/api/contacts?${query}`);
  }

  getContact(id: string) {
    return this.fetch(`/api/contacts/${id}`);
  }

  createContact(data: any) {
    return this.fetch('/api/contacts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateContact(id: string, data: any) {
    return this.fetch(`/api/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  starContact(id: string, starred: boolean) {
    return this.fetch(`/api/contacts/${id}/star`, {
      method: 'POST',
      body: JSON.stringify({ starred }),
    });
  }

  // Communications
  getCommunications(params: { contactId?: string; cursor?: string }) {
    const query = new URLSearchParams();
    if (params.contactId) query.set('contact_id', params.contactId);
    if (params.cursor) query.set('cursor', params.cursor);
    return this.fetch(`/api/communications?${query}`);
  }

  // Facts
  createFact(data: any) {
    return this.fetch('/api/facts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  deleteFact(id: string) {
    return this.fetch(`/api/facts/${id}`, { method: 'DELETE' });
  }

  // Notes
  getNotes(contactId: string) {
    return this.fetch(`/api/notes?contact_id=${contactId}`);
  }

  createNote(data: any) {
    return this.fetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Follow-ups
  getPendingFollowups() {
    return this.fetch('/api/followups/pending');
  }

  completeFollowup(id: string) {
    return this.fetch(`/api/followups/${id}/complete`, { method: 'POST' });
  }
}

export const api = new ApiClient();
```

## Implementation Steps

1. Install dependencies: `@tanstack/react-query`, `react-hook-form`, `zod`, `lucide-react`
2. Set up shadcn/ui components (Button, Input, Card, Badge, Tabs, etc.)
3. Create auth provider and login page
4. Create API client with all endpoints
5. Create React Query hooks for data fetching
6. Build layout components (header, sidebar, nav)
7. Build Dashboard page with follow-ups and activity
8. Build Contact List page with search and filters
9. Build Contact Detail page with all sections
10. Add forms for creating contacts, facts, notes
11. Add loading states and error handling
12. Test all pages with backend API

## Acceptance Criteria

- [ ] Login page authenticates and redirects to dashboard
- [ ] Dashboard shows pending follow-ups grouped by urgency
- [ ] Dashboard shows recent activity
- [ ] Contact list loads with infinite scroll
- [ ] Contact search filters results
- [ ] Contact detail shows all facts organized by category
- [ ] Contact detail shows communication timeline
- [ ] Contact detail shows notes with markdown
- [ ] Facts can be added and deleted
- [ ] Notes can be added
- [ ] Follow-ups can be completed from dashboard
- [ ] Starred contacts show star icon
- [ ] Loading states shown during data fetches
- [ ] Unauthorized requests redirect to login

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/frontend/app/login/page.tsx` | Login page |
| `packages/frontend/app/page.tsx` | Dashboard |
| `packages/frontend/app/contacts/page.tsx` | Contact list |
| `packages/frontend/app/contacts/[id]/page.tsx` | Contact detail |
| `packages/frontend/app/layout.tsx` | Root layout |
| `packages/frontend/components/layout/*` | Layout components |
| `packages/frontend/components/dashboard/*` | Dashboard components |
| `packages/frontend/components/contacts/*` | Contact list components |
| `packages/frontend/components/contact-detail/*` | Contact detail components |
| `packages/frontend/lib/api.ts` | API client |
| `packages/frontend/lib/hooks/*.ts` | React Query hooks |
| `packages/frontend/providers/*.tsx` | Context providers |

## Notes for Implementation

- Use shadcn/ui `npx shadcn-ui@latest add <component>` to add components
- React Query devtools helpful for debugging
- Consider adding optimistic updates for better UX
- Mobile responsiveness handled via Tailwind breakpoints
- Authentication state persisted via httpOnly cookie from backend
- Use Next.js middleware for auth protection if needed
