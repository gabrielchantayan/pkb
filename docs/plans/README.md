# PKB Implementation Plans

This directory contains 14 implementation plans for the Personal Knowledge Base / CRM system. Each plan is designed as a self-contained handoff document for AI agents (Claude Code) to implement autonomously.

## Plan Overview

| # | Plan | Description | Est. Scope |
|---|------|-------------|------------|
| 01 | [Project Foundation](./01-project-foundation.md) | Monorepo, database schema, Docker | Large |
| 02 | [Authentication](./02-authentication.md) | Password auth, API keys, sessions | Medium |
| 03 | [Contacts Core](./03-contacts-core.md) | Contact CRUD, identifiers, merge | Medium |
| 04 | [Communications](./04-communications.md) | Message storage, batch sync, attachments | Large |
| 05 | [Facts System](./05-facts-system.md) | Facts CRUD, versioning, conflicts | Medium |
| 06 | [Notes](./06-notes.md) | Notes with markdown, attachments | Small |
| 07 | [Follow-ups](./07-followups.md) | Reminders, suggestions, completion | Medium |
| 08 | [Tags & Organization](./08-tags-organization.md) | Tags, groups, smart lists | Medium |
| 09 | [Search](./09-search.md) | Full-text + semantic search | Medium |
| 10 | [AI Integration](./10-ai-integration.md) | Gemini API, fact extraction, queries | Large |
| 11 | [Daemon Core + iMessage](./11-daemon-core-imessage.md) | Go daemon, sync, iMessage source | Large |
| 12 | [Daemon Additional Sources](./12-daemon-additional-sources.md) | Gmail, Calendar, Contacts, Calls, Notes | Large |
| 13 | [Frontend Core](./13-frontend-core.md) | Dashboard, contact list/detail | Large |
| 14 | [Frontend Advanced](./14-frontend-advanced.md) | Search, AI query, settings, graph | Medium |

## Dependency Graph

```
01-project-foundation
    │
    ├── 02-authentication
    │       │
    │       ├── 03-contacts-core
    │       │       │
    │       │       ├── 04-communications ──────┐
    │       │       │       │                   │
    │       │       │       └── 10-ai-integration
    │       │       │               │
    │       │       ├── 05-facts-system ────────┤
    │       │       │                           │
    │       │       ├── 06-notes                │
    │       │       │                           │
    │       │       ├── 07-followups ◄──────────┤
    │       │       │                           │
    │       │       └── 08-tags-organization ───┘
    │       │
    │       └── 11-daemon-core-imessage
    │               │
    │               └── 12-daemon-additional-sources
    │
    └── 13-frontend-core
            │
            └── 14-frontend-advanced

09-search (requires 04, 05, 06, soft-depends on 10 for semantic)
```

## Recommended Implementation Order

### Phase 1: Foundation (Backend Core)
1. **01-project-foundation** - Must be first
2. **02-authentication** - Enables protected endpoints
3. **03-contacts-core** - Core entity

### Phase 2: Data Storage (Backend)
4. **04-communications** - Message storage
5. **05-facts-system** - Fact storage
6. **06-notes** - Note storage
7. **08-tags-organization** - Organization system

### Phase 3: Features (Backend)
8. **07-followups** - Reminder system
9. **09-search** - Search (keyword initially)
10. **10-ai-integration** - LLM processing

### Phase 4: Daemon
11. **11-daemon-core-imessage** - Go daemon + iMessage
12. **12-daemon-additional-sources** - Additional data sources

### Phase 5: Frontend
13. **13-frontend-core** - Core pages
14. **14-frontend-advanced** - Advanced features

## Plan Structure

Each plan follows a consistent structure:

- **Overview**: What the feature does (1-2 sentences)
- **Dependencies**: What must exist before, what this unblocks
- **Technical Decisions**: Key choices already made
- **Database Tables**: Schema if applicable
- **API Endpoints**: Full API specification
- **Implementation**: Code examples and patterns
- **Implementation Steps**: Ordered checklist
- **Acceptance Criteria**: Definition of done
- **Files to Create**: Explicit file list
- **Notes**: Gotchas and patterns

## For AI Agents

When implementing a plan:

1. Read the entire plan first
2. Verify dependencies are satisfied
3. Follow implementation steps in order
4. Mark acceptance criteria as you complete them
5. Create all files listed in the Files to Create table
6. Reference the SPEC.md for additional context if needed

## Key Technical Decisions (Cross-cutting)

| Area | Decision |
|------|----------|
| Backend DB | PostgreSQL with raw SQL (no ORM) |
| Backend Framework | Express + TypeScript |
| Frontend | Next.js App Router + shadcn/ui |
| Package Manager | Yarn workspaces |
| Daemon | Go |
| LLM | Google Gemini (Flash for extraction, Pro for queries) |
| Embeddings | Gemini text-embedding-004 (768 dimensions) |
| Auth | Password + session for frontend, API key for daemon |
| File Storage | Local filesystem (S3-compatible later) |

## Notes

- Multiple Gmail accounts supported (see 12-daemon-additional-sources)
- All timestamps use TIMESTAMPTZ (timezone-aware)
- Soft deletes via `deleted_at` column
- Audit logging for all mutations
- Full-text search via PostgreSQL tsvector
- Semantic search via pgvector
