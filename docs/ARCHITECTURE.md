# System Architecture

The Personal Knowledge Base (PKB) is a monorepo built with a modern TypeScript stack and a local Go daemon.

## High-Level Overview

```mermaid
graph TD
    User[User via Browser] --> Frontend[Next.js Frontend]
    Frontend --> Backend[Express Backend API]
    Backend --> DB[(PostgreSQL + pgvector)]
    Backend --> AI[Google Gemini AI]
    Daemon[Go Daemon] -->|Syncs Data| Backend
    Daemon --> LocalSources[Local Data (iMessage, Calendar)]
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

## Components

### 1. Frontend (`packages/frontend`)
*   **Framework:** Next.js 14 (App Router).
*   **UI Library:** Shadcn/UI + Tailwind CSS v4.
*   **State Management:** React Query (TanStack Query) for server state.
*   **Rendering:** Hybrid of Server Components and Client Components.

### 2. Backend (`packages/backend`)
*   **Framework:** Node.js + Express.
*   **Database Access:** Raw SQL via `pg` driver (no ORM) for performance and control.
*   **AI Integration:** Google Gemini via `@google/generative-ai`.
*   **Search:** Hybrid search using full-text (Postgres `tsvector`) and semantic search (`pgvector`).
*   **Validation:** Zod schemas for all inputs.

### 3. Shared Library (`packages/shared`)
*   Contains TypeScript interfaces (`Contact`, `Fact`, `Communication`) shared between Frontend and Backend to ensure type safety across the network boundary.
*   Contains shared constants and domain logic (e.g., Fact categories).

### 4. Daemon (`daemon/`)
*   **Language:** Go (Golang).
*   **Purpose:** Runs locally on the user's machine (macOS optimized) to harvest personal data that isn't accessible via public APIs.
*   **Functionality:**
    *   Reads local SQLite databases (e.g., `chat.db` for iMessages).
    *   Batches and uploads data to the Backend API.
    *   Handles offline queuing (store-and-forward) using a local SQLite queue.

## Data Flow

1.  **Ingestion:** The **Daemon** reads local data sources, standardizes them, and pushes them to the **Backend**.
2.  **Processing:** The **Backend** receives data, stores raw records, and triggers AI jobs to extract "Facts" (e.g., "User mentioned they like coffee").
3.  **Storage:** Data is stored in **PostgreSQL**. Embeddings are generated for semantic search.
4.  **Retrieval:** The **Frontend** queries the Backend. Search results combine keyword matches and vector similarity.
