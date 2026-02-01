# PKB - Personal Knowledge Base

A self-hosted personal CRM and knowledge management system that aggregates your communications, contacts, and notes into a unified, searchable interface with AI-powered insights.

## Features

- **Unified Contact Management** - Consolidate contacts from Apple Contacts, iMessage, Gmail, and more into a single view with automatic duplicate detection and merging
- **Communication History** - Aggregate and search conversations from iMessage, Gmail, and phone calls
- **AI-Powered Insights** - Automatic fact extraction, sentiment analysis, and semantic search powered by Google Gemini
- **Relationship Graph** - Visualize connections between contacts and their interactions
- **Smart Lists & Tags** - Organize contacts with custom tags and dynamic smart lists
- **Notes & Follow-ups** - Attach notes to contacts and set reminders for follow-ups
- **Calendar Integration** - Sync events from Google Calendar and Apple Calendar
- **Privacy-First** - All data stays on your infrastructure; nothing is sent to third parties except the configured AI provider

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
│                         localhost:3000                           │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend (Express)                         │
│                         localhost:4000                           │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│   │   REST API   │  │   AI Service │  │   Background Jobs    │  │
│   └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PostgreSQL + pgvector                          │
│                         localhost:5432                           │
└─────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │
┌─────────────────────────────────────────────────────────────────┐
│                         Daemon (Go)                              │
│            Runs locally to access macOS data sources             │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│   │ iMessage │ │  Gmail   │ │ Calendar │ │ Contacts │  ...      │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, React Query |
| Backend | Express 5, TypeScript, Zod |
| Database | PostgreSQL 16 with pgvector extension |
| AI | Google Gemini (embeddings, extraction, chat) |
| Daemon | Go 1.22+ |
| Container | Docker & Docker Compose |
| Package Manager | Yarn 4 (Workspaces) |

## Prerequisites

- **Docker & Docker Compose** - Recommended for running the full stack
- **Node.js 20+** - For local development
- **Yarn 4** - Package manager (corepack enabled)
- **Go 1.22+** - For building the daemon
- **macOS** - Required for the daemon to access local data sources

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd pkb

# Copy environment template
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Required
API_KEY=<secure-random-string>
JWT_SECRET=<secure-random-string>
GEMINI_API_KEY=<your-google-gemini-api-key>
DATABASE_URL=postgres://pkb:pkb@localhost:5432/pkb
```

### 2. Start with Docker

```bash
docker compose up --build
```

This starts:
- **Frontend** at http://localhost:3000
- **Backend** at http://localhost:4000
- **PostgreSQL** at localhost:5432

### 3. Create Initial User

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=your-password yarn db:seed
```

### 4. Start the Daemon (Optional)

The daemon syncs data from local macOS sources. Configure `daemon/config.yaml`:

```yaml
backend:
  url: http://localhost:4000
  api_key: <same-as-API_KEY-in-.env>

sources:
  imessage:
    enabled: true
  contacts:
    enabled: true
  # ... configure other sources
```

Build and run:

```bash
cd daemon
go build -o build/pkb-daemon ./cmd/pkb-daemon
./build/pkb-daemon -config config.yaml
```

## Development

### Local Development Setup

```bash
# Install dependencies
yarn install

# Start database (via Docker)
docker compose up -d db

# Run migrations
yarn db:migrate

# Start development servers (backend + frontend)
yarn dev
```

### Project Structure

```
pkb/
├── packages/
│   ├── backend/          # Express API server
│   │   ├── src/
│   │   │   ├── routes/   # API endpoints
│   │   │   ├── services/ # Business logic
│   │   │   ├── db/       # Database migrations & queries
│   │   │   └── middleware/
│   │   └── package.json
│   │
│   ├── frontend/         # Next.js application
│   │   ├── app/          # App router pages
│   │   ├── components/   # React components
│   │   └── lib/          # Utilities & hooks
│   │
│   └── shared/           # Shared types & utilities
│
├── daemon/               # Go data sync daemon
│   ├── cmd/              # Entry points
│   └── internal/         # Internal packages
│       ├── sources/      # Data source implementations
│       ├── sync/         # Sync orchestration
│       └── api/          # Backend API client
│
├── docs/                 # Documentation
├── docker-compose.yml    # Container orchestration
└── package.json          # Root workspace config
```

### Available Scripts

```bash
# Development
yarn dev              # Start all services in dev mode
yarn build            # Build all packages

# Database
yarn db:migrate       # Run database migrations
yarn db:seed          # Seed initial admin user

# Individual packages
yarn workspace @pkb/backend dev     # Backend only
yarn workspace @pkb/frontend dev    # Frontend only
yarn workspace @pkb/backend test    # Run backend tests
```

## Data Sources

The daemon supports syncing from the following sources:

| Source | Description | Requirements |
|--------|-------------|--------------|
| **iMessage** | Messages from iMessage/SMS | Full Disk Access permission |
| **Contacts** | Apple Contacts | Contacts access permission |
| **Gmail** | Email from Gmail | OAuth credentials |
| **Calendar** | Google & Apple Calendar | Calendar access permission |
| **Phone Calls** | Call history | Full Disk Access permission |
| **Notes** | Apple Notes | Notes access permission |

### macOS Permissions

The daemon requires specific macOS permissions to access data:

1. **System Preferences > Privacy & Security > Full Disk Access** - Add Terminal or your IDE
2. **System Preferences > Privacy & Security > Contacts** - Grant access when prompted
3. **System Preferences > Privacy & Security > Calendars** - Grant access when prompted

## API Documentation

The backend exposes a REST API at `http://localhost:4000`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/auth/login` | POST | User authentication |
| `/api/contacts` | GET/POST | Contact management |
| `/api/contacts/:id` | GET/PUT/DELETE | Individual contact |
| `/api/communications` | GET/POST | Communication history |
| `/api/search` | GET | Full-text & semantic search |
| `/api/ai/chat` | POST | AI-powered queries |
| `/api/facts` | GET/POST | Contact facts |
| `/api/notes` | GET/POST | Notes management |
| `/api/followups` | GET/POST | Follow-up reminders |
| `/api/sync/*` | POST | Daemon sync endpoints |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `API_KEY` | API key for daemon authentication | Yes |
| `JWT_SECRET` | Secret for JWT signing | Yes |
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `PORT` | Backend server port (default: 4000) | No |
| `NODE_ENV` | Environment (development/production) | No |
| `AI_ENABLED` | Enable AI features (default: true) | No |
| `STORAGE_TYPE` | Attachment storage type (local/s3) | No |
| `STORAGE_PATH` | Local storage path | No |

## Security Considerations

- All authentication uses JWT tokens
- The daemon authenticates via API key
- Sensitive data (passwords) are hashed with bcrypt
- Environment variables should never be committed
- Consider running behind a reverse proxy (nginx/caddy) in production
- Enable HTTPS in production deployments

## License

MIT
