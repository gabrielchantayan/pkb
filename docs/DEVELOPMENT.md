# Development Guide

## Project Structure

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

## Available Scripts

Run these from the root directory:

```bash
# Development
yarn install          # Install all dependencies
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

## Backend Development

### Database
*   **Migrations:** managed in `packages/backend/src/db/migrations`.
*   **Run Migrations:** `yarn workspace @pkb/backend db:migrate`
*   **Seed Data:** `yarn workspace @pkb/backend db:seed`

### Testing
We use **Vitest** for backend testing.
```bash
yarn workspace @pkb/backend test
```

## Daemon Development (Go)

*   **Format Code:** `go fmt ./...`
*   **Run Locally:** `go run cmd/daemon/main.go`
*   **Build:** `go build -o bin/daemon cmd/daemon/main.go`

## Contributing

1.  Create a feature branch.
2.  Make changes.
3.  Ensure tests pass.
4.  Submit a Pull Request.

### Code Style
*   **Backend:** Follow the existing "Transaction Script" pattern. Use raw SQL with parameterized queries.
*   **Frontend:** Use Shadcn/UI components where possible.
