# API Reference

The backend exposes a REST API at `http://localhost:4000`.

## Authentication

All endpoints except `/health` and `/api/auth/login` require a valid JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

The daemon uses API key authentication via the `X-API-Key` header.

## Endpoints

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

## Common Response Formats

### Success Response
```json
{
  "data": { ... },
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

### Error Response
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": { ... }
  }
}
```
