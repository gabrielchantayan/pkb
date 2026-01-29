# Personal Knowledge Base / CRM - Specification

## Overview

A personal knowledge base and CRM system for managing contacts and personal affairs. The system consists of three components:

1. **Frontend**: Next.js + shadcn/ui web application
2. **Backend**: TypeScript/Express API server with PostgreSQL
3. **Daemon**: Go application running on macOS that syncs local data sources

The system extracts and stores facts about people from communications, maintains a searchable archive of all communications, manages follow-up reminders, and provides AI-powered querying capabilities.

## Goals

- Never forget important details about people
- Manage follow-ups and pending action items
- Maintain a searchable archive of all communications
- Extract insights and track relationships over time
- Self-hostable, privacy-focused design

---

## Architecture

### High-Level Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Mac Daemon    │────▶│  Backend API    │◀────│    Frontend     │
│      (Go)       │     │  (Express/TS)   │     │   (Next.js)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │                       ▼
        │               ┌─────────────────┐
        │               │   PostgreSQL    │
        │               └─────────────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  Local Sources  │     │  Gemini API     │
│ iMessage, Gmail │     │  (LLM + Embed)  │
│ Calendar, Notes │     └─────────────────┘
│ Calls, Contacts │
└─────────────────┘
```

### Repository Structure

**Monorepo** using Yarn workspaces:

```
/
├── packages/
│   ├── frontend/          # Next.js + shadcn
│   ├── backend/           # Express + PostgreSQL
│   └── shared/            # Shared types and utilities
├── daemon/                # Go daemon (separate module)
├── docker-compose.yml     # Full stack deployment
├── SPEC.md
└── package.json           # Yarn workspace root
```

---

## Component Specifications

### 1. Backend (TypeScript/Express)

#### Tech Stack
- **Runtime**: Node.js
- **Framework**: Express
- **Database**: PostgreSQL (raw SQL, no ORM)
- **API Style**: REST
- **Package Manager**: Yarn

#### API Endpoints

##### Contacts
- `GET /api/contacts` - List contacts (pagination, filters, search)
- `GET /api/contacts/:id` - Get contact detail with facts and timeline
- `POST /api/contacts` - Create contact
- `PUT /api/contacts/:id` - Update contact
- `DELETE /api/contacts/:id` - Soft delete contact
- `POST /api/contacts/:id/merge` - Merge duplicate contacts
- `POST /api/contacts/:id/star` - Toggle starred status
- `GET /api/contacts/duplicates` - Get suggested duplicate merges

##### Communications
- `GET /api/communications` - List communications (filters by contact, source, date)
- `GET /api/communications/:id` - Get single communication with full content
- `POST /api/communications/batch` - Batch upsert from daemon
- `GET /api/communications/search` - Full-text and semantic search

##### Facts
- `GET /api/facts` - List facts (filter by contact, type, source)
- `POST /api/facts` - Create manual fact
- `PUT /api/facts/:id` - Update fact
- `DELETE /api/facts/:id` - Soft delete fact
- `GET /api/facts/:id/history` - Get fact version history
- `GET /api/facts/conflicts` - Get conflicting facts for review

##### Notes
- `GET /api/notes` - List notes
- `GET /api/notes/:id` - Get note with attachments
- `POST /api/notes` - Create note (markdown + attachments)
- `PUT /api/notes/:id` - Update note
- `DELETE /api/notes/:id` - Soft delete note
- `POST /api/notes/:id/attachments` - Upload attachment

##### Follow-ups
- `GET /api/followups` - List pending follow-ups
- `POST /api/followups` - Create manual follow-up
- `PUT /api/followups/:id` - Update/complete follow-up
- `DELETE /api/followups/:id` - Delete follow-up
- `GET /api/followups/suggestions` - Get AI-suggested follow-ups

##### Tags & Groups
- `GET /api/tags` - List tags
- `POST /api/tags` - Create tag
- `GET /api/groups` - List hierarchical groups
- `POST /api/groups` - Create group
- `GET /api/smartlists` - Get smart list definitions
- `POST /api/smartlists` - Create smart list

##### Search & AI
- `POST /api/search` - Combined search (full-text + filters + semantic)
- `POST /api/ai/query` - Single-shot AI query against data
- `POST /api/ai/extract` - Extract facts from text (used by daemon)

##### Sync
- `POST /api/sync/batch` - Receive batch sync from daemon
- `GET /api/sync/status` - Get sync status for daemon
- `POST /api/sync/attachments` - Upload attachment files

##### Dashboard
- `GET /api/dashboard` - Dashboard data (follow-ups, recent activity, stats)

##### Auth
- `POST /api/auth/login` - Password login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

##### System
- `GET /api/health` - Health check
- `GET /api/audit` - Audit log (paginated)

#### Authentication
- Simple password authentication for single user
- API key authentication for daemon
- Sessions stored in PostgreSQL or signed JWT

#### LLM Integration
- **Provider**: Google Gemini API
- **Models**: Configurable (Flash for extraction, Pro for complex queries)
- **Embeddings**: Gemini embeddings for semantic search
- **Processing**: All LLM processing happens on backend

**Fact Extraction Pipeline**:
1. Daemon sends raw communication to backend
2. Backend queues for LLM processing
3. Gemini extracts facts with confidence scores
4. Facts stored with source reference
5. Conflicting facts flagged for review
6. Retry with exponential backoff on failure

#### File Storage
- **Configurable**: Local filesystem or S3-compatible storage
- **Types**: All attachment types stored
- **Organization**: By date and contact ID

#### Logging
- Structured JSON logging
- Log levels: debug, info, warn, error
- Include request ID for tracing

---

### 2. Frontend (Next.js + shadcn)

#### Tech Stack
- **Framework**: Next.js (App Router)
- **UI**: shadcn/ui components
- **Styling**: Tailwind CSS
- **State**: React Query for server state
- **Package Manager**: Yarn

#### Pages

##### Dashboard (`/`)
- **Follow-ups Due**: List of pending reminders and AI-suggested follow-ups
- **Recent Activity**: Latest communications and extracted facts
- **Contact Stats**: Most/least contacted, engagement trends
- **Quick Actions**: Add contact, add note, search

##### Contacts (`/contacts`)
- List view with search, filters (tags, groups, smart lists)
- Sort by name, last contact, relationship strength
- Bulk actions (tag, group, delete)

##### Contact Detail (`/contacts/:id`)
- **Header**: Name, photo, starred status, key info
- **Facts Section**: Extracted and manual facts, organized by category
  - Basic info: birthday, location, job, company
  - Relationships: spouse, children, how you met, mutual friends
  - Freeform facts with tags
- **Timeline**: Communications across all sources
  - Configurable grouping: by conversation, flat, by source
  - Full message content viewable
- **Notes**: Manual notes with markdown and attachments
- **Follow-ups**: Pending and completed reminders
- **Relationship Graph**: Connections to other contacts
- **Metrics**: Engagement score, sentiment trend

##### Search (`/search`)
- Global search bar
- Advanced filters: date range, source, contact, tags
- Results grouped by type (contacts, messages, facts, notes)
- Semantic search results highlighted

##### AI Query (`/ai`)
- Single query interface
- Example queries shown
- Results with source citations

##### Relationship Graph (`/graph`)
- Visual graph of contact relationships
- Node size by importance/engagement
- Edge thickness by interaction frequency
- Filter by groups/tags

##### Settings (`/settings`)
- Profile and password
- Follow-up rules per tag/group
- Notification preferences
- Blocklist management
- Event reminder configuration per fact type
- Smart list definitions

#### Mobile Support
- Responsive design for mobile web access
- Touch-friendly controls
- Simplified navigation on small screens

---

### 3. Daemon (Go)

#### Tech Stack
- **Language**: Go
- **Config**: YAML configuration file
- **Sync**: Continuous background sync
- **Logging**: Structured JSON logs

#### Data Sources

##### iMessage
- **Method**: Direct SQLite database access (`~/Library/Messages/chat.db`)
- **Requires**: Full Disk Access permission
- **Data**: All messages, attachments, participants
- **Deduplication**: Track last synced message ID

##### Gmail
- **Method**: Gmail API (OAuth) or IMAP (app password)
- **Data**: All emails, metadata, attachments
- **Deduplication**: Track last synced email ID/timestamp

##### Apple Contacts
- **Method**: Contacts framework or AddressBook database
- **Data**: All fields including notes, photos, groups
- **Initial Import**: Full contact list to bootstrap

##### Calendar (Google/Apple)
- **Method**: CalDAV or Google Calendar API
- **Data**: All events with attendees, descriptions
- **Sync**: Ongoing sync of new/modified events

##### Phone Calls
- **Method**: macOS FaceTime/recent calls database
- **Data**: Call log with participants, duration, timestamps

##### Apple Notes
- **Method**: Notes database or AppleScript
- **Data**: Note content, timestamps
- **Contact Linking**: LLM extracts mentioned contact names

##### Twitter/X DMs
- **Method**: Research Beeper's approach
- **Priority**: v2 feature (after core sources working)

##### Instagram DMs
- **Method**: Research Beeper's approach
- **Priority**: v2 feature (after core sources working)

#### Sync Behavior
- **Mode**: Continuous background sync
- **Protocol**: Full initial sync, then delta syncs
- **Offline**: Queue changes locally, sync when connection restored
- **Batching**: Collect changes, POST in batches to backend

#### Identity Resolution
- **Auto-suggest merges**: System detects likely duplicates
- **Signals**: Same email, phone, name variations
- **User confirms**: Merges require user confirmation in frontend

#### Blocklist
- Configurable list of email addresses, phone numbers, or contact names to exclude from sync

#### Configuration (YAML)

```yaml
backend:
  url: https://your-vps.example.com
  api_key: your-api-key

sources:
  imessage:
    enabled: true
    db_path: ~/Library/Messages/chat.db
  gmail:
    enabled: true
    method: api  # or imap
    credentials_path: ./gmail-creds.json
  calendar:
    enabled: true
    providers:
      - type: google
        credentials_path: ./gcal-creds.json
  notes:
    enabled: true
  calls:
    enabled: true
  contacts:
    enabled: true
    import_photos: true

sync:
  interval_seconds: 60
  batch_size: 100
  history_import: all  # or date range

blocklist:
  emails:
    - spam@example.com
  phones:
    - "+15551234567"

logging:
  level: info
  format: json
  path: ./daemon.log
```

---

## Data Model

### Core Entities

#### Contact
```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  photo_url TEXT,
  starred BOOLEAN DEFAULT false,
  manual_importance INTEGER,  -- user-set importance rating
  engagement_score DECIMAL,   -- auto-calculated
  sentiment_trend TEXT,       -- positive, negative, neutral
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ      -- soft delete
);
```

#### Contact Identifier (for multi-email/phone)
```sql
CREATE TABLE contact_identifiers (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id),
  type TEXT NOT NULL,  -- email, phone, social_handle
  value TEXT NOT NULL,
  source TEXT,         -- where this was discovered
  created_at TIMESTAMPTZ,
  UNIQUE(type, value)
);
```

#### Communication
```sql
CREATE TABLE communications (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,        -- imessage, gmail, twitter, etc.
  source_id TEXT NOT NULL,     -- original ID from source
  contact_id UUID REFERENCES contacts(id),
  direction TEXT,              -- inbound, outbound
  subject TEXT,
  content TEXT,                -- full message content
  content_embedding VECTOR(768), -- Gemini embedding
  timestamp TIMESTAMPTZ,
  metadata JSONB,              -- source-specific data
  sentiment TEXT,              -- per-message sentiment
  created_at TIMESTAMPTZ,
  UNIQUE(source, source_id)
);
```

#### Conversation (for grouping)
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  source_thread_id TEXT,
  participants UUID[],         -- contact IDs
  sentiment_aggregate TEXT,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  message_count INTEGER
);
```

#### Fact
```sql
CREATE TABLE facts (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id),
  category TEXT,               -- basic_info, relationship, preference, custom
  fact_type TEXT,              -- birthday, job_title, spouse, etc.
  value TEXT NOT NULL,
  structured_value JSONB,      -- for predefined types
  source TEXT,                 -- extracted, manual
  source_communication_id UUID REFERENCES communications(id),
  confidence DECIMAL,
  has_conflict BOOLEAN DEFAULT false,
  reminder_enabled BOOLEAN DEFAULT false, -- for birthdays, etc.
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
```

#### Fact History (for versioning)
```sql
CREATE TABLE fact_history (
  id UUID PRIMARY KEY,
  fact_id UUID REFERENCES facts(id),
  value TEXT,
  structured_value JSONB,
  changed_at TIMESTAMPTZ,
  change_source TEXT
);
```

#### Note
```sql
CREATE TABLE notes (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id),
  content TEXT,                -- markdown content
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
```

#### Note Attachment
```sql
CREATE TABLE note_attachments (
  id UUID PRIMARY KEY,
  note_id UUID REFERENCES notes(id),
  filename TEXT,
  mime_type TEXT,
  storage_path TEXT,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ
);
```

#### Communication Attachment
```sql
CREATE TABLE communication_attachments (
  id UUID PRIMARY KEY,
  communication_id UUID REFERENCES communications(id),
  filename TEXT,
  mime_type TEXT,
  storage_path TEXT,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ
);
```

#### Follow-up
```sql
CREATE TABLE followups (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id),
  type TEXT,                   -- manual, time_based, content_detected
  reason TEXT,
  due_date DATE,
  source_communication_id UUID REFERENCES communications(id),
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);
```

#### Tag
```sql
CREATE TABLE tags (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT,
  followup_days INTEGER        -- default follow-up threshold for this tag
);
```

#### Contact Tag
```sql
CREATE TABLE contact_tags (
  contact_id UUID REFERENCES contacts(id),
  tag_id UUID REFERENCES tags(id),
  PRIMARY KEY (contact_id, tag_id)
);
```

#### Group (hierarchical)
```sql
CREATE TABLE groups (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES groups(id),
  followup_days INTEGER
);
```

#### Contact Group
```sql
CREATE TABLE contact_groups (
  contact_id UUID REFERENCES contacts(id),
  group_id UUID REFERENCES groups(id),
  PRIMARY KEY (contact_id, group_id)
);
```

#### Smart List
```sql
CREATE TABLE smart_lists (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  rules JSONB NOT NULL         -- filter rules definition
);
```

#### Relationship (between contacts)
```sql
CREATE TABLE contact_relationships (
  id UUID PRIMARY KEY,
  contact_a_id UUID REFERENCES contacts(id),
  contact_b_id UUID REFERENCES contacts(id),
  relationship_type TEXT,      -- colleague, family, friend, inferred
  source TEXT,                 -- cc_email, group_chat, llm_extracted
  strength DECIMAL,            -- interaction-based score
  created_at TIMESTAMPTZ
);
```

#### Calendar Event
```sql
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY,
  source TEXT,
  source_id TEXT,
  title TEXT,
  description TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  attendee_contact_ids UUID[],
  location TEXT,
  created_at TIMESTAMPTZ,
  UNIQUE(source, source_id)
);
```

#### Audit Log
```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  entity_type TEXT,
  entity_id UUID,
  action TEXT,                 -- create, update, delete
  old_value JSONB,
  new_value JSONB,
  timestamp TIMESTAMPTZ
);
```

#### Sync State
```sql
CREATE TABLE sync_state (
  source TEXT PRIMARY KEY,
  last_sync_at TIMESTAMPTZ,
  last_id TEXT,
  metadata JSONB
);
```

---

## LLM Processing

### Fact Extraction

**Input**: Raw communication text
**Output**: Structured facts

**Predefined Fact Types**:

*Basic Info*:
- `birthday` (date)
- `location` (city, country)
- `job_title` (string)
- `company` (string)
- `email` (string)
- `phone` (string)

*Relationships*:
- `spouse` (name)
- `child` (name, age)
- `parent` (name)
- `sibling` (name)
- `friend` (name)
- `colleague` (name)
- `how_we_met` (description)
- `mutual_connection` (name)

*Custom*: Freeform fact with optional tags

### Follow-up Detection

**Content-based triggers**:
- "Let's catch up next week"
- "I'll send you that document"
- "Can you review this by Friday"
- Action items and commitments

### Sentiment Analysis

- Per-conversation sentiment (positive/negative/neutral)
- Overall relationship trend over time

### AI Query

**Example queries**:
- "When is John's birthday?"
- "Who works at Google?"
- "Find all mentions of travel plans"
- "Summarize my relationship with Sarah"
- "Who haven't I talked to in 3 months?"

---

## Deployment

### Docker Compose

```yaml
version: '3.8'

services:
  frontend:
    build: ./packages/frontend
    ports:
      - "3000:3000"
    environment:
      - BACKEND_URL=http://backend:4000
    depends_on:
      - backend

  backend:
    build: ./packages/backend
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/pkb
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - API_KEY=${DAEMON_API_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - STORAGE_TYPE=local  # or s3
      - STORAGE_PATH=/data/attachments
    volumes:
      - attachments:/data/attachments
    depends_on:
      - db

  db:
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=pkb
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  pgdata:
  attachments:
```

### Environment Variables

**Backend**:
- `DATABASE_URL` - PostgreSQL connection string
- `GEMINI_API_KEY` - Google Gemini API key
- `API_KEY` - Daemon authentication key
- `JWT_SECRET` - JWT signing secret
- `STORAGE_TYPE` - `local` or `s3`
- `STORAGE_PATH` - Local storage path (if local)
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` - S3 config (if s3)

**Frontend**:
- `BACKEND_URL` - Backend API URL

---

## Security Considerations

- HTTPS required for all communication
- API key for daemon-to-backend auth
- Password + session for frontend auth
- Blocklist for excluding sensitive contacts
- Soft deletes preserve data for audit
- Comprehensive audit logging
- No client-side storage of credentials

---

## v1 Priorities

### Phase 1: Foundation
1. Backend API scaffolding with PostgreSQL
2. Core data models and migrations
3. Authentication (password + API key)
4. Basic CRUD for contacts, notes, facts

### Phase 2: Daemon MVP
1. iMessage sync (priority data source)
2. Apple Contacts import
3. Sync protocol to backend
4. Local queue for offline resilience

### Phase 3: Frontend MVP
1. Dashboard with basic stats
2. Contact list and detail views
3. Manual note-taking
4. Search (keyword-based)

### Phase 4: LLM Integration
1. Gemini API integration
2. Fact extraction pipeline
3. Embeddings for semantic search
4. AI query interface

### Phase 5: Additional Sources
1. Gmail sync
2. Calendar sync
3. Phone calls
4. Apple Notes

### v2 Features (Future)
- Twitter/Instagram DM sync
- Relationship graph visualization
- Sentiment tracking and trends
- Smart list rules engine
- Mobile PWA optimization

---

## Open Questions

1. **Social DM sync**: Need to research Beeper's approach for Twitter/Instagram. May require browser extension or periodic data export import.

2. **LLM cost management**: With 100-500 contacts and full message history, LLM costs could add up. Consider batching, caching, and only processing new messages.

3. **Attachment storage limits**: Storing all attachments forever will grow large. May need to add configurable retention or compression later.

4. **Contact photo sync**: Need to verify best method for extracting photos from Apple Contacts.

---

## Success Metrics

- Zero forgotten follow-ups
- < 5 second search response time
- 95%+ fact extraction accuracy (manual review baseline)
- Full communication history searchable
- Dashboard provides actionable daily overview
