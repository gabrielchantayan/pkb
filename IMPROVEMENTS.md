# Codebase Improvements & Deep Dive Analysis

This document outlines recommended improvements for the Personal Knowledge Base (PKB) codebase, based on a deep-dive analysis of the Frontend, Backend, Daemon, and Infrastructure.

## 🚨 Critical Priority
*These items pose immediate risks to stability, debugging, or security and should be addressed first.*

### 1. Implement Testing Framework (Backend)
**Status:** ❌ Missing
The backend currently has **zero** test files or configuration.
*   **Action:** Install `vitest` or `jest` and `supertest`.
*   **Goal:** Create integration tests for critical flows like `contacts.merge` and `search`.
*   **Why:** Refactoring logic without a safety net is high-risk.

### 2. Fix Backend Error Handling
**Status:** ⚠️ Inconsistent
Many routes (e.g., `src/routes/contacts.ts`) catch errors and return a generic `500` response without logging the actual error.
*   **Refactor:**
    ```typescript
    // Current
    catch (e) { res.status(500).json({ error: 'Internal server error' }); }

    // Recommended
    catch (e) { next(e); } // Delegate to central error logging middleware
    ```
*   **Why:** Debugging production issues is currently impossible for these routes.

### 3. Secure Configuration
**Status:** ⚠️ Risks Detected
*   `src/config.ts` defaults `DATABASE_URL` to a hardcoded string containing a password.
*   `docker-compose.yml` is missing `GEMINI_API_KEY`, `API_KEY` (Daemon auth), and `JWT_SECRET` for the backend service.
*   **Action:** Remove default credentials from code; enforce environment variable presence. Update `docker-compose.yml`.

---

## 🏗️ Backend Architecture

### 1. Safe Transaction Management
**Status:** Manual `BEGIN`/`ROLLBACK`
Transactions are manually managed, which is error-prone (potential connection leaks if `client.release()` is skipped).
*   **Action:** Implement a `withTransaction` helper.
    ```typescript
    export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> { ... }
    ```

### 2. Refactor "God Functions"
**Status:** High Complexity
`src/services/contacts.ts` contains massive functions like `merge_contacts` (~150+ lines) mixing business logic with raw SQL.
*   **Action:**
    *   Extract SQL queries into a Data Access Layer (DAO) or Repository.
    *   Split logic into smaller helpers (e.g., `updateContactFacts`, `mergeAuditLogs`).

---

## 🎨 Frontend & UX

### 1. Image Optimization
**Status:** Unoptimized
The `Avatar` component uses standard `<img>` tags.
*   **Action:** Replace with `next/image` to leverage automatic resizing, lazy loading, and format conversion (WebP/AVIF).

### 2. State Management (URL-based)
**Status:** Local State
Search filters (e.g., on `ContactsPage`) live in `useState`. Refreshing the page clears them.
*   **Action:** "Lift" state to the URL query parameters (`?q=search+term`). This makes views shareable and persistent.

### 3. Error Feedback
**Status:** Silent Failures
API errors handled by React Query often result in empty states without user feedback.
*   **Action:** Implement a global `useEffect` or `onError` callback in hooks to trigger Toast notifications when requests fail.

### 4. Server Components
**Status:** Underutilized
Heavy usage of `"use client"` on top-level pages bypasses Next.js SSR benefits.
*   **Action:** Refactor page roots to be Server Components that fetch initial data, passing it to client-side interactive islands.

---

## 🔄 Daemon (Go)

### 1. Context Propagation
**Status:** Missing
Database operations in `internal/queue` do not accept `context.Context`.
*   **Action:** Update DB methods to support cancellation and timeouts via `ExecContext` and `QueryContext`.

### 2. Signal Handling
**Status:** Minor Timing Issue
Ensure the main run loop checks for context cancellation *before* starting a new sync cycle to shut down promptly.

---

## 🛠️ Infrastructure & Tooling

### 1. CI/CD Pipelines
**Status:** ❌ Missing
No GitHub Actions or CI configuration exists.
*   **Action:** Create `.github/workflows/ci.yml` to run:
    *   Linting (Frontend & Backend)
    *   Type Checking (`tsc --noEmit`)
    *   Build verification (`yarn build`)

### 2. Standardized Linting
**Status:** Inconsistent
No root-level `.eslintrc` or `.prettierrc` to enforce style across the monorepo.
*   **Action:** Add root configuration to ensure consistent formatting between Frontend, Backend, and Shared packages.
