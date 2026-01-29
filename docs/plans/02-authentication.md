# Feature: Authentication

## Overview

Implement password authentication for the frontend user and API key authentication for the daemon. Single-user system with session management.

## Dependencies

- **Requires**: 01-project-foundation (database, Express app scaffold)
- **Blocks**: All features that need protected endpoints

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session storage | PostgreSQL | Simpler than Redis for single-user |
| Password hashing | bcrypt | Industry standard, built-in salt |
| Session tokens | Signed JWT or secure random | JWT for stateless, random+DB for stateful |
| API key format | 32-byte hex string | Simple, secure enough for daemon auth |

## Deliverables

### 1. Database Tables

```sql
-- Add to migrations
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial user (password set via env or first-run)
```

### 2. Auth Middleware

```typescript
// src/middleware/auth.ts

// Session auth for frontend
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const session = await db.query(
    'SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  if (!session.rows[0]) return res.status(401).json({ error: 'Invalid session' });

  req.userId = session.rows[0].user_id;
  next();
}

// API key auth for daemon
export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const keyHash = hashApiKey(apiKey);
  const result = await db.query(
    'UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1 RETURNING id',
    [keyHash]
  );
  if (!result.rows[0]) return res.status(401).json({ error: 'Invalid API key' });

  next();
}

// Combined: accepts either session or API key
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.headers['x-api-key']) {
    return requireApiKey(req, res, next);
  }
  return requireSession(req, res, next);
}
```

### 3. Auth Routes

```typescript
// src/routes/auth.ts
router.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!user.rows[0]) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await db.query(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [user.rows[0].id, token, expiresAt]
  );

  res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax', expires: expiresAt });
  res.json({ user: { id: user.rows[0].id, email: user.rows[0].email } });
});

router.post('/api/auth/logout', requireSession, async (req, res) => {
  const token = req.cookies?.session;
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.clearCookie('session');
  res.json({ success: true });
});

router.get('/api/auth/me', requireSession, async (req, res) => {
  const user = await db.query('SELECT id, email FROM users WHERE id = $1', [req.userId]);
  res.json({ user: user.rows[0] });
});
```

### 4. Initial User Setup

```typescript
// src/db/seed.ts
async function seedInitialUser() {
  const email = process.env.ADMIN_EMAIL || 'admin@localhost';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error('ADMIN_PASSWORD env required for initial setup');
    process.exit(1);
  }

  const existing = await db.query('SELECT id FROM users LIMIT 1');
  if (existing.rows[0]) {
    console.log('User already exists, skipping seed');
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await db.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
    [email, hash]
  );
  console.log(`Created user: ${email}`);
}
```

### 5. API Key Management

```typescript
// src/routes/apikeys.ts (admin only)
router.post('/api/auth/api-keys', requireSession, async (req, res) => {
  const { name } = req.body;

  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  await db.query(
    'INSERT INTO api_keys (name, key_hash) VALUES ($1, $2)',
    [name, keyHash]
  );

  // Only time the raw key is returned
  res.json({ apiKey: rawKey, name });
});

router.get('/api/auth/api-keys', requireSession, async (req, res) => {
  const keys = await db.query(
    'SELECT id, name, last_used_at, created_at FROM api_keys ORDER BY created_at DESC'
  );
  res.json({ apiKeys: keys.rows });
});

router.delete('/api/auth/api-keys/:id', requireSession, async (req, res) => {
  await db.query('DELETE FROM api_keys WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});
```

### 6. Environment Variables

```bash
# .env
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=your-secure-password
JWT_SECRET=random-32-byte-secret  # if using JWT
```

## Implementation Steps

1. Add migration for `users`, `sessions`, `api_keys` tables
2. Install dependencies: `bcrypt`, `cookie-parser`
3. Create `src/lib/auth.ts` with password hashing utilities
4. Create `src/middleware/auth.ts` with all auth middleware
5. Create `src/routes/auth.ts` with login/logout/me endpoints
6. Create `src/routes/apikeys.ts` for API key management
7. Create `src/db/seed.ts` for initial user creation
8. Add `cookie-parser` middleware to Express app
9. Update health route to be public, protect other routes
10. Add `db:seed` script to package.json
11. Test login flow with curl/Postman
12. Test API key auth with daemon header

## Acceptance Criteria

- [ ] `POST /api/auth/login` returns session cookie on valid credentials
- [ ] `POST /api/auth/login` returns 401 on invalid credentials
- [ ] `GET /api/auth/me` returns user info with valid session
- [ ] `GET /api/auth/me` returns 401 without session
- [ ] `POST /api/auth/logout` clears session
- [ ] Protected routes accept `X-API-Key` header as alternative to session
- [ ] API keys can be created, listed, and deleted
- [ ] Initial user created via `yarn db:seed`
- [ ] Sessions expire after 30 days

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/db/migrations/002_auth.sql` | Auth tables |
| `packages/backend/src/lib/auth.ts` | Password/key hashing utilities |
| `packages/backend/src/middleware/auth.ts` | Auth middleware |
| `packages/backend/src/routes/auth.ts` | Login/logout/me endpoints |
| `packages/backend/src/routes/apikeys.ts` | API key management |
| `packages/backend/src/db/seed.ts` | Initial user seeding |

## Notes for Implementation

- Never log passwords or API keys
- API keys are hashed before storage (one-way)
- Raw API key only shown once at creation time
- Use constant-time comparison for token validation
- Set secure cookie flags in production
- Consider rate limiting login attempts (future enhancement)
