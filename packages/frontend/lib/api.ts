const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface SearchResult {
  type: 'contact' | 'communication' | 'fact' | 'note';
  id: string;
  score: number;
  highlights?: string[];
  data: Record<string, unknown>;
  contact?: {
    id: string;
    displayName: string;
  };
}

export interface AiQueryResponse {
  answer: string;
  confidence: number;
  sources: Array<{
    id: string;
    type: string;
    snippet: string;
  }>;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  followup_days: number | null;
  contact_count?: number;
}

export interface Group {
  id: string;
  name: string;
  parent_id: string | null;
  followup_days: number | null;
  contact_count?: number;
}

export interface SmartList {
  id: string;
  name: string;
  rules: object;
  contact_count?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface BlockedIdentifier {
  id: string;
  identifier: string;
  identifier_type: string;
  created_at: string;
}

export interface Relationship {
  id: string;
  contact_id: string;
  label: string;
  person_name: string;
  linked_contact_id: string | null;
  linked_contact_name: string | null;
  linked_contact_photo: string | null;
  source: 'extracted' | 'manual';
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface RelationshipGraphData {
  contacts: Array<{
    id: string;
    displayName: string;
    engagementScore: number | null;
    starred: boolean;
  }>;
  relationships: Array<{
    contact_a_id: string;
    contact_b_id: string;
    strength: number;
  }>;
}

export interface LoginResponse {
  token: string;
  user: { id: string; email: string };
}

export interface DashboardData {
  stats: {
    total_contacts: number;
    pending_followups: number;
    recent_communications: number;
  };
  recent_activity: Array<{
    id: string;
    type: string;
    contact_id: string;
    contact_name: string;
    description: string;
    timestamp: string;
  }>;
}

export interface Contact {
  id: string;
  display_name: string;
  photo_url: string | null;
  starred: boolean;
  emails: string[];
  phone_numbers: string[];
  created_at: string;
  updated_at: string;
  tags?: Array<{ id: string; name: string; color: string }>;
}

export interface ContactsResponse {
  contacts: Contact[];
  nextCursor: string | null;
  total: number;
}

export interface Identifier {
  id: string;
  type: 'email' | 'phone' | 'social';
  value: string;
  is_primary: boolean;
}

export interface Fact {
  id: string;
  contact_id: string;
  fact_type: string;
  value: string;
  category: string | null;
  source: 'manual' | 'extracted';
  confidence: number | null;
  has_conflict: boolean;
  created_at: string;
}

export interface Communication {
  id: string;
  contact_id: string;
  source: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  subject: string | null;
  content: string;
  raw_content: string | null;
}

export interface CommunicationsResponse {
  communications: Communication[];
  nextCursor: string | null;
}

export interface Note {
  id: string;
  contact_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Followup {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_photo: string | null;
  reason: string;
  due_date: string;
  status: 'pending' | 'completed' | 'dismissed';
}

export interface PendingFollowupsResponse {
  overdue: Followup[];
  today: Followup[];
  upcoming: Followup[];
}

export interface ContactDetailResponse {
  contact: Contact;
  identifiers: Identifier[];
  facts: Fact[];
  recent_communications: Communication[];
  tags: Array<{ id: string; name: string; color: string }>;
  groups: Array<{ id: string; name: string }>;
}

export interface DuplicateSuggestion {
  contacts: [Contact, Contact];
  confidence: number;
  reason: 'same_email' | 'same_phone' | 'similar_name';
}

export interface MergePreview {
  target: Contact;
  source: Contact;
  target_identifiers: Identifier[];
  source_identifiers: Identifier[];
  counts: {
    identifiers: number;
    communications: number;
    facts: number;
    notes: number;
    followups: number;
    tags: number;
    groups: number;
  };
}

class ApiClient {
  private token: string | null = null;

  set_token(token: string | null) {
    this.token = token;
  }

  get_token(): string | null {
    return this.token;
  }

  private async fetch_json<T>(path: string, options: RequestInit = {}): Promise<T> {
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
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
      const error_text = await res.text();
      throw new Error(`API error: ${res.status} - ${error_text}`);
    }

    return res.json();
  }

  // Auth
  login(email: string, password: string): Promise<LoginResponse> {
    return this.fetch_json('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  logout(): Promise<void> {
    return this.fetch_json('/api/auth/logout', { method: 'POST' });
  }

  get_me(): Promise<{ id: string; email: string }> {
    return this.fetch_json('/api/auth/me');
  }

  // Dashboard
  get_dashboard(): Promise<DashboardData> {
    return this.fetch_json('/api/dashboard');
  }

  // Contacts
  get_contacts(params: { search?: string; cursor?: string; limit?: number; saved_only?: boolean }): Promise<ContactsResponse> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.saved_only !== undefined) query.set('saved_only', String(params.saved_only));
    return this.fetch_json(`/api/contacts?${query}`);
  }

  get_contact(id: string): Promise<ContactDetailResponse> {
    return this.fetch_json(`/api/contacts/${id}`);
  }

  create_contact(data: { display_name: string; emails?: string[]; phone_numbers?: string[] }): Promise<Contact> {
    return this.fetch_json('/api/contacts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  update_contact(id: string, data: Partial<Contact>): Promise<Contact> {
    return this.fetch_json(`/api/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  star_contact(id: string, starred: boolean): Promise<Contact> {
    return this.fetch_json(`/api/contacts/${id}/star`, {
      method: 'POST',
      body: JSON.stringify({ starred }),
    });
  }

  get_duplicates(): Promise<{ duplicates: DuplicateSuggestion[] }> {
    return this.fetch_json('/api/contacts/duplicates');
  }

  get_merge_preview(target_id: string, source_id: string): Promise<MergePreview> {
    return this.fetch_json(`/api/contacts/${target_id}/merge-preview/${source_id}`);
  }

  merge_contacts(target_id: string, source_id: string): Promise<{ contact: Contact }> {
    return this.fetch_json(`/api/contacts/${target_id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ mergeContactId: source_id }),
    });
  }

  // Communications
  get_communications(params: { contact_id?: string; cursor?: string }): Promise<CommunicationsResponse> {
    const query = new URLSearchParams();
    if (params.contact_id) query.set('contact_id', params.contact_id);
    if (params.cursor) query.set('cursor', params.cursor);
    return this.fetch_json(`/api/communications?${query}`);
  }

  // Facts
  create_fact(data: { contact_id: string; fact_type: string; value: string; category?: string }): Promise<Fact> {
    return this.fetch_json('/api/facts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  delete_fact(id: string): Promise<void> {
    return this.fetch_json(`/api/facts/${id}`, { method: 'DELETE' });
  }

  // Notes
  get_notes(contact_id: string): Promise<{ notes: Note[] }> {
    return this.fetch_json(`/api/notes?contact_id=${contact_id}`);
  }

  create_note(data: { contact_id: string; content: string }): Promise<Note> {
    return this.fetch_json('/api/notes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  update_note(id: string, data: { content: string }): Promise<Note> {
    return this.fetch_json(`/api/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  delete_note(id: string): Promise<void> {
    return this.fetch_json(`/api/notes/${id}`, { method: 'DELETE' });
  }

  // Follow-ups
  get_pending_followups(): Promise<PendingFollowupsResponse> {
    return this.fetch_json('/api/followups/pending');
  }

  get_contact_followups(contact_id: string): Promise<{ followups: Followup[] }> {
    return this.fetch_json(`/api/followups?contact_id=${contact_id}`);
  }

  create_followup(data: { contact_id: string; reason: string; due_date: string }): Promise<Followup> {
    return this.fetch_json('/api/followups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  complete_followup(id: string): Promise<Followup> {
    return this.fetch_json(`/api/followups/${id}/complete`, { method: 'POST' });
  }

  dismiss_followup(id: string): Promise<Followup> {
    return this.fetch_json(`/api/followups/${id}/dismiss`, { method: 'POST' });
  }

  // Search
  search(params: {
    query: string;
    mode?: 'keyword' | 'semantic' | 'combined';
    types?: string[];
    filters?: object;
  }): Promise<{ results: SearchResult[]; totalEstimate: number }> {
    return this.fetch_json('/api/search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // AI
  ai_query(query: string, contact_id?: string): Promise<AiQueryResponse> {
    return this.fetch_json('/api/ai/query', {
      method: 'POST',
      body: JSON.stringify({ query, contact_id }),
    });
  }

  // Tags
  get_tags(): Promise<{ tags: Tag[] }> {
    return this.fetch_json('/api/tags');
  }

  create_tag(data: { name: string; color?: string; followup_days?: number }): Promise<Tag> {
    return this.fetch_json('/api/tags', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  delete_tag(id: string): Promise<void> {
    return this.fetch_json(`/api/tags/${id}`, { method: 'DELETE' });
  }

  // Groups
  get_groups(): Promise<{ groups: Group[] }> {
    return this.fetch_json('/api/groups');
  }

  create_group(data: { name: string; parent_id?: string; followup_days?: number }): Promise<Group> {
    return this.fetch_json('/api/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  delete_group(id: string): Promise<void> {
    return this.fetch_json(`/api/groups/${id}`, { method: 'DELETE' });
  }

  // Smart Lists
  get_smart_lists(): Promise<{ smart_lists: SmartList[] }> {
    return this.fetch_json('/api/smartlists');
  }

  create_smart_list(data: { name: string; rules: object }): Promise<SmartList> {
    return this.fetch_json('/api/smartlists', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  delete_smart_list(id: string): Promise<void> {
    return this.fetch_json(`/api/smartlists/${id}`, { method: 'DELETE' });
  }

  // API Keys
  get_api_keys(): Promise<{ api_keys: ApiKey[] }> {
    return this.fetch_json('/api/auth/api-keys');
  }

  create_api_key(name: string): Promise<{ api_key: ApiKey; key: string }> {
    return this.fetch_json('/api/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  delete_api_key(id: string): Promise<void> {
    return this.fetch_json(`/api/auth/api-keys/${id}`, { method: 'DELETE' });
  }

  // Blocklist
  get_blocklist(): Promise<{ blocked_identifiers: BlockedIdentifier[] }> {
    return this.fetch_json('/api/blocklist');
  }

  add_to_blocklist(identifier: string, identifier_type: string): Promise<BlockedIdentifier> {
    return this.fetch_json('/api/blocklist', {
      method: 'POST',
      body: JSON.stringify({ identifier, identifier_type }),
    });
  }

  remove_from_blocklist(id: string): Promise<void> {
    return this.fetch_json(`/api/blocklist/${id}`, { method: 'DELETE' });
  }

  // Relationships
  get_relationships(contact_id: string): Promise<{ relationships: Relationship[] }> {
    return this.fetch_json(`/api/relationships?contact_id=${contact_id}`);
  }

  create_relationship(data: { contact_id: string; label: string; person_name: string; linked_contact_id?: string }): Promise<{ relationship: Relationship }> {
    return this.fetch_json('/api/relationships', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  update_relationship(id: string, data: { label?: string; person_name?: string; linked_contact_id?: string | null }): Promise<{ relationship: Relationship }> {
    return this.fetch_json(`/api/relationships/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  delete_relationship(id: string): Promise<void> {
    return this.fetch_json(`/api/relationships/${id}`, { method: 'DELETE' });
  }

  // Relationship Graph
  get_relationship_graph(): Promise<RelationshipGraphData> {
    return this.fetch_json('/api/relationships/graph');
  }
}

export const api = new ApiClient();
