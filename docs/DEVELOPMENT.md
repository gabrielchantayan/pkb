# Development Guide

## Project Structure

*   `packages/backend`: API Server (Express)
*   `packages/frontend`: Web App (Next.js)
*   `packages/shared`: Shared Types & Logic
*   `daemon`: Go Sync Client

## Common Commands

Run these from the root directory:

*   **Install Dependencies:** `yarn install`
*   **Run Dev Server:** `yarn dev` (starts both frontend and backend in watch mode)
*   **Build:** `yarn build`

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
