import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  query: vi.fn(),
}));

vi.mock('./gemini.js', () => ({
  generate_embedding: vi.fn(),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { query } from '../../db/index.js';
import { generate_embedding } from './gemini.js';
import { check_semantic_duplicate, generate_fact_embedding } from './dedup.js';

const mock_query = vi.mocked(query);
const mock_embedding = vi.mocked(generate_embedding);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('check_semantic_duplicate', () => {
  const test_embedding = Array(768).fill(0.1);

  it('returns is_duplicate true when similarity >= threshold', async () => {
    mock_query.mockResolvedValueOnce({
      rows: [{ id: 'fact-1', value: 'works at Google', similarity: 0.92 }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const result = await check_semantic_duplicate(
      'contact-1', 'company', 'employed at Google', test_embedding, 0.80
    );

    expect(result.is_duplicate).toBe(true);
    expect(result.matching_fact_id).toBe('fact-1');
    expect(result.similarity).toBe(0.92);
  });

  it('returns is_duplicate false when similarity < threshold', async () => {
    mock_query.mockResolvedValueOnce({
      rows: [{ id: 'fact-1', value: 'works at Google', similarity: 0.65 }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const result = await check_semantic_duplicate(
      'contact-1', 'company', 'works at Meta', test_embedding, 0.80
    );

    expect(result.is_duplicate).toBe(false);
  });

  it('returns is_duplicate false when no existing facts found', async () => {
    mock_query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const result = await check_semantic_duplicate(
      'contact-1', 'company', 'works at Meta', test_embedding, 0.80
    );

    expect(result.is_duplicate).toBe(false);
  });

  it('passes correct SQL query with pgvector cosine distance', async () => {
    mock_query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    await check_semantic_duplicate('contact-1', 'location', 'Portland', test_embedding, 0.80);

    expect(mock_query).toHaveBeenCalledOnce();
    const sql = mock_query.mock.calls[0][0] as string;
    expect(sql).toContain('value_embedding <=> $3::vector');
    expect(sql).toContain('contact_id = $1');
    expect(sql).toContain('fact_type = $2');
    expect(sql).toContain('deleted_at IS NULL');
  });
});

describe('generate_fact_embedding', () => {
  it('returns embedding on success', async () => {
    const embedding = Array(768).fill(0.5);
    mock_embedding.mockResolvedValueOnce(embedding);

    const result = await generate_fact_embedding('works at Google');
    expect(result).toEqual(embedding);
  });

  it('returns null on failure without throwing', async () => {
    mock_embedding.mockRejectedValueOnce(new Error('API error'));

    const result = await generate_fact_embedding('works at Google');
    expect(result).toBeNull();
  });
});
