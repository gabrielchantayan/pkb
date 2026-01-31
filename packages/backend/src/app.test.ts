import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { create_app } from './app.js';

// Mock the database pool
vi.mock('./db/index.js', () => ({
  get_pool: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
  })),
}));

describe('App', () => {
  const app = create_app();

  it('GET /api/health returns 200', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'connected' });
  });
});
