# Feature: Project Foundation

## Overview

Set up the monorepo structure, database schema, shared types, and Docker deployment configuration. This is the foundation all other features build upon.

## Dependencies

- **Requires**: None (this is the first feature)
- **Blocks**: All other features

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package manager | Yarn workspaces | Specified in SPEC |
| Database | PostgreSQL 16 with pgvector | Vector embeddings for semantic search |
| ORM | None (raw SQL) | Specified in SPEC |
| Backend framework | Express | Specified in SPEC |
| Frontend framework | Next.js App Router | Already scaffolded in `/frontend` |

## Deliverables

### 1. Monorepo Structure

```
/
├── packages/
│   ├── frontend/          # Move existing frontend here
│   ├── backend/           # New Express app
│   └── shared/            # Shared TypeScript types
├── daemon/                # Go module (placeholder for now)
├── docker-compose.yml
├── package.json           # Yarn workspace root
├── tsconfig.base.json     # Shared TS config
└── SPEC.md
```

### 2. Root package.json

```json
{
  "name": "pkb",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "concurrently \"yarn workspace @pkb/backend dev\" \"yarn workspace @pkb/frontend dev\"",
    "build": "yarn workspaces foreach -pt run build",
    "db:migrate": "yarn workspace @pkb/backend db:migrate",
    "db:seed": "yarn workspace @pkb/backend db:seed"
  }
}
```

### 3. Shared Package (`packages/shared`)

Export TypeScript types used by both frontend and backend:

```typescript
// packages/shared/src/types/contact.ts
export interface Contact {
  id: string;
  displayName: string;
  photoUrl: string | null;
  starred: boolean;
  manualImportance: number | null;
  engagementScore: number | null;
  sentimentTrend: 'positive' | 'negative' | 'neutral' | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// Similar types for all entities in SPEC.md Data Model section
```

### 4. Backend Package (`packages/backend`)

Scaffold Express app with:

```
packages/backend/
├── src/
│   ├── index.ts           # Entry point
│   ├── app.ts             # Express app setup
│   ├── config.ts          # Environment config
│   ├── db/
│   │   ├── index.ts       # Database connection pool
│   │   ├── migrations/    # SQL migration files
│   │   └── migrate.ts     # Migration runner
│   ├── routes/
│   │   └── health.ts      # Health check endpoint
│   ├── middleware/
│   │   ├── auth.ts        # Auth middleware (stub)
│   │   ├── error.ts       # Error handler
│   │   └── logging.ts     # Request logging
│   └── lib/
│       └── logger.ts      # Structured JSON logger
├── package.json
└── tsconfig.json
```

### 5. Database Migrations

Create initial migration with ALL tables from SPEC.md Data Model:

```sql
-- 001_initial_schema.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Contacts table
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  photo_url TEXT,
  starred BOOLEAN DEFAULT false,
  manual_importance INTEGER,
  engagement_score DECIMAL,
  sentiment_trend TEXT CHECK (sentiment_trend IN ('positive', 'negative', 'neutral')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Include ALL tables from SPEC.md:
-- contact_identifiers, communications, conversations, facts, fact_history,
-- notes, note_attachments, communication_attachments, followups, tags,
-- contact_tags, groups, contact_groups, smart_lists, contact_relationships,
-- calendar_events, audit_log, sync_state
```

### 6. Docker Compose

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
      - DATABASE_URL=postgres://pkb:pkb@db:5432/pkb
      - NODE_ENV=development
    depends_on:
      db:
        condition: service_healthy

  db:
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_USER=pkb
      - POSTGRES_PASSWORD=pkb
      - POSTGRES_DB=pkb
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pkb"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

### 7. Move Existing Frontend

- Move `/frontend` contents to `/packages/frontend`
- Update package.json name to `@pkb/frontend`
- Add dependency on `@pkb/shared`

## Implementation Steps

1. Create root `package.json` with workspace config
2. Create `packages/shared` with all entity types from SPEC
3. Create `packages/backend` scaffold with Express, health endpoint
4. Set up database connection with `pg` package
5. Create migration runner and initial schema migration
6. Move frontend to `packages/frontend`, update imports
7. Create `docker-compose.yml`
8. Create root `tsconfig.base.json` for shared compiler options
9. Test: `docker compose up` starts all services
10. Test: `GET /api/health` returns 200
11. Test: Database has all tables created

## Acceptance Criteria

- [ ] `yarn install` at root installs all workspace dependencies
- [ ] `yarn dev` starts both backend (port 4000) and frontend (port 3000)
- [ ] `docker compose up` builds and runs all services
- [ ] `GET http://localhost:4000/api/health` returns `{ "status": "ok" }`
- [ ] Database contains all 17 tables from SPEC data model
- [ ] `@pkb/shared` types can be imported in both frontend and backend
- [ ] Structured JSON logging works in backend

## Files to Create

| Path | Purpose |
|------|---------|
| `package.json` | Yarn workspace root |
| `tsconfig.base.json` | Shared TypeScript config |
| `docker-compose.yml` | Full stack deployment |
| `.env.example` | Environment variable template |
| `packages/shared/package.json` | Shared types package |
| `packages/shared/src/index.ts` | Export all types |
| `packages/shared/src/types/*.ts` | Entity type definitions |
| `packages/backend/package.json` | Backend package config |
| `packages/backend/src/index.ts` | Entry point |
| `packages/backend/src/app.ts` | Express setup |
| `packages/backend/src/config.ts` | Env config loader |
| `packages/backend/src/db/index.ts` | DB connection pool |
| `packages/backend/src/db/migrate.ts` | Migration runner |
| `packages/backend/src/db/migrations/001_initial_schema.sql` | Full schema |
| `packages/backend/src/routes/health.ts` | Health endpoint |
| `packages/backend/src/middleware/*.ts` | Core middleware |
| `packages/backend/Dockerfile` | Backend container |
| `packages/frontend/Dockerfile` | Frontend container |

## Notes for Implementation

- Use `pg` package directly, not an ORM
- All timestamps should be `TIMESTAMPTZ` (timezone-aware)
- Use `gen_random_uuid()` for UUID generation in Postgres
- The `vector(768)` column type is for Gemini embeddings
- Soft deletes use `deleted_at` column, not actual deletion
- Keep migrations idempotent where possible
