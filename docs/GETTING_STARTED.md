# Getting Started

Welcome to the Personal Knowledge Base (PKB). This guide will help you set up and run the application.

## Prerequisites

*   **Docker & Docker Compose** (Recommended for running the full stack)
*   **Node.js v20+** & **Yarn** (For local development)
*   **Go 1.22+** (For building the local daemon)
*   **PostgreSQL 16** (If running without Docker)

## Configuration

The application relies on environment variables for configuration.

### 1. Environment Variables
Create a `.env` file in the root directory (or ensure these are passed to Docker).

**Required Secrets:**
```bash
# Security & Auth
API_KEY=your-secure-api-key-for-daemon
JWT_SECRET=your-random-jwt-secret-string
GEMINI_API_KEY=your-google-gemini-api-key

# Database
DATABASE_URL=postgres://pkb:pkb@localhost:5432/pkb
```

## Quick Start (Docker)

The easiest way to run the PKB (Frontend, Backend, and Database) is via Docker Compose.

1.  **Configure environment:**
    Ensure your `.env` variables are set (or modify `docker-compose.yml` locally).

2.  **Start services:**
    ```bash
    docker-compose up --build
    ```

3.  **Access the application:**
    *   Frontend: [http://localhost:3000](http://localhost:3000)
    *   Backend API: [http://localhost:4000](http://localhost:4000)

## Creating Your First Account

PKB uses a seed script to create the initial user account. Run the following command with your desired email and password:

```bash
# Load .env variables and run the seed
export $(cat .env | xargs) && ADMIN_EMAIL=your@email.com ADMIN_PASSWORD=your-secure-password yarn workspace @pkb/backend db:seed
```

**Notes:**
- `DATABASE_URL` must be available (from `.env` or exported)
- If `ADMIN_EMAIL` is not set, it defaults to `admin@localhost`
- `ADMIN_PASSWORD` is required
- The seed script only creates a user if no users exist yet. If a user already exists, it skips creation.

After seeding, you can log in at [http://localhost:3000](http://localhost:3000) with your credentials.

## Manual Setup (Local Development)

If you prefer to run services individually for development:

### 1. Database
Start a PostgreSQL instance with `pgvector` extension enabled.
```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pkb -e POSTGRES_USER=pkb -e POSTGRES_DB=pkb pgvector/pgvector:pg16
```
Run migrations:
```bash
yarn workspace @pkb/backend db:migrate
```

### 2. Backend
```bash
# Install dependencies
yarn install

# Start development server
yarn workspace @pkb/backend dev
```

### 3. Frontend
```bash
# Start Next.js development server
yarn workspace @pkb/frontend dev
```

### 4. Daemon (Data Sync)
The daemon runs on your host machine to access local data (iMessage, Calendar).
```bash
cd daemon
go mod download
go run cmd/daemon/main.go
```
*Note: The daemon requires `config.yaml` to be configured. See [USAGE.md](./USAGE.md) for details.*
