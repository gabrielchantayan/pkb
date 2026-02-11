import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  query: vi.fn(),
}));

vi.mock('../services/ai/batching.js', () => ({
  get_unprocessed_contacts: vi.fn(),
  get_contact_batches: vi.fn(),
  format_batch_prompt: vi.fn(),
}));

vi.mock('../services/ai/extraction.js', () => ({
  extract_from_batch: vi.fn(),
}));

vi.mock('../services/facts.js', () => ({
  create_extracted_fact_v2: vi.fn(),
}));

vi.mock('../services/relationships.js', () => ({
  create_extracted_relationship: vi.fn(),
}));

vi.mock('../services/followups.js', () => ({
  create_content_detected_followup: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    frf_cron_interval: '*/30 * * * *',
    frf_batch_size: 15,
    frf_batch_overlap: 2,
    frf_context_messages: 5,
    frf_confidence_threshold: 0.75,
    frf_dedup_similarity: 0.80,
    frf_followup_cutoff_days: 90,
    frf_batch_delay_ms: 0, // No delay in tests
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(() => ({ stop: vi.fn() })),
    validate: vi.fn(() => true),
  },
}));

import { query } from '../db/index.js';
import { get_unprocessed_contacts, get_contact_batches, format_batch_prompt } from '../services/ai/batching.js';
import { extract_from_batch } from '../services/ai/extraction.js';
import { create_extracted_fact_v2 } from '../services/facts.js';
import { create_extracted_relationship } from '../services/relationships.js';
import { create_content_detected_followup } from '../services/followups.js';
import cron from 'node-cron';
import { run_frf_pipeline, start_frf_cron, stop_frf_cron } from './frf-cron.js';
import type { ContactBatch } from '../services/ai/batching.js';

const mock_query = vi.mocked(query);
const mock_get_unprocessed = vi.mocked(get_unprocessed_contacts);
const mock_get_batches = vi.mocked(get_contact_batches);
const mock_format_prompt = vi.mocked(format_batch_prompt);
const mock_extract = vi.mocked(extract_from_batch);
const mock_create_fact = vi.mocked(create_extracted_fact_v2);
const mock_create_rel = vi.mocked(create_extracted_relationship);
const mock_create_followup = vi.mocked(create_content_detected_followup);

function make_batch(overrides: Partial<ContactBatch> = {}): ContactBatch {
  return {
    contact_id: 'contact-1',
    contact_name: 'Alice',
    context_messages: [],
    batch_messages: [{
      id: 'msg-1',
      content: 'Test message content here',
      source: 'imessage',
      direction: 'inbound',
      subject: null,
      timestamp: new Date('2024-06-15T10:00:00Z'),
      contact_id: 'contact-1',
      contact_name: 'Alice',
    }],
    communication_ids: ['msg-1', 'msg-2'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: UPDATE query succeeds
  mock_query.mockResolvedValue({
    rows: [],
    rowCount: 0,
    command: 'UPDATE',
    oid: 0,
    fields: [],
  });
});

// ── Pipeline: basic flow ───────────────────────────────────────────────────

describe('run_frf_pipeline', () => {
  it('returns early with no contacts to process', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([]);

    const result = await run_frf_pipeline();

    expect(result.contacts_processed).toBe(0);
    expect(result.batches_processed).toBe(0);
    expect(mock_get_batches).not.toHaveBeenCalled();
  });

  it('processes a contact with one batch end-to-end', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'contact-1', contact_name: 'Alice', unprocessed_count: 2 },
    ]);

    const batch = make_batch();
    mock_get_batches.mockResolvedValueOnce([batch]);
    mock_format_prompt.mockReturnValueOnce('formatted prompt');
    mock_extract.mockResolvedValueOnce({
      facts: [{ fact_type: 'company', value: 'Acme Corp', confidence: 0.9 }],
      relationships: [{ label: 'Colleague', person_name: 'Bob', confidence: 0.85 }],
      followups: [{ reason: 'Send report', suggested_date: '2024-07-01' }],
    });
    mock_create_fact.mockResolvedValueOnce({ action: 'inserted' });
    mock_create_rel.mockResolvedValueOnce({ id: 'rel-1' } as any);
    mock_create_followup.mockResolvedValueOnce({ id: 'fu-1' } as any);

    const result = await run_frf_pipeline();

    expect(result.contacts_processed).toBe(1);
    expect(result.batches_processed).toBe(1);
    expect(result.facts_created).toBe(1);
    expect(result.relationships_created).toBe(1);
    expect(result.followups_created).toBe(1);
    expect(result.errors).toBe(0);

    // Verify communications marked as processed
    expect(mock_query).toHaveBeenCalledWith(
      expect.stringContaining('frf_processed_at'),
      [['msg-1', 'msg-2']],
    );
  });

  it('counts deduplicated and superseded facts', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
    ]);
    mock_get_batches.mockResolvedValueOnce([make_batch()]);
    mock_format_prompt.mockReturnValueOnce('prompt');
    mock_extract.mockResolvedValueOnce({
      facts: [
        { fact_type: 'company', value: 'Acme', confidence: 0.9 },
        { fact_type: 'location', value: 'Portland', confidence: 0.8 },
        { fact_type: 'hobby', value: 'running', confidence: 0.85 },
      ],
      relationships: [],
      followups: [],
    });
    mock_create_fact
      .mockResolvedValueOnce({ action: 'inserted' })
      .mockResolvedValueOnce({ action: 'superseded' })
      .mockResolvedValueOnce({ action: 'skipped_duplicate' });

    const result = await run_frf_pipeline();

    expect(result.facts_created).toBe(1);
    expect(result.facts_superseded).toBe(1);
    expect(result.facts_deduplicated).toBe(1);
  });

  it('tracks followups_skipped_cutoff when followup returns null', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
    ]);
    mock_get_batches.mockResolvedValueOnce([make_batch()]);
    mock_format_prompt.mockReturnValueOnce('prompt');
    mock_extract.mockResolvedValueOnce({
      facts: [],
      relationships: [],
      followups: [{ reason: 'old followup', suggested_date: '2024-01-01' }],
    });
    mock_create_followup.mockResolvedValueOnce(null);

    const result = await run_frf_pipeline();

    expect(result.followups_skipped_cutoff).toBe(1);
    expect(result.followups_created).toBe(0);
  });

  it('processes multiple contacts sequentially', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
      { contact_id: 'c2', contact_name: 'Bob', unprocessed_count: 1 },
    ]);

    mock_get_batches
      .mockResolvedValueOnce([make_batch({ contact_id: 'c1', contact_name: 'Alice' })])
      .mockResolvedValueOnce([make_batch({ contact_id: 'c2', contact_name: 'Bob' })]);

    mock_format_prompt.mockReturnValue('prompt');
    mock_extract.mockResolvedValue({ facts: [], relationships: [], followups: [] });

    const result = await run_frf_pipeline();

    expect(result.contacts_processed).toBe(2);
    expect(result.batches_processed).toBe(2);
  });
});

// ── Pipeline: mutex ────────────────────────────────────────────────────────

describe('mutex', () => {
  it('skips run if pipeline is already running', async () => {
    mock_get_unprocessed.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([
        { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
      ]), 50))
    );
    mock_get_batches.mockResolvedValue([make_batch()]);
    mock_format_prompt.mockReturnValue('prompt');
    mock_extract.mockResolvedValue({ facts: [], relationships: [], followups: [] });

    // Start two concurrent runs
    const [result1, result2] = await Promise.all([
      run_frf_pipeline(),
      run_frf_pipeline(),
    ]);

    // One should have run, one should be skipped
    const skipped = [result1, result2].filter((r) => r.skipped);
    expect(skipped).toHaveLength(1);
  });
});

// ── Pipeline: error handling ───────────────────────────────────────────────

describe('error handling', () => {
  it('stops entire run on rate limit (429)', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
      { contact_id: 'c2', contact_name: 'Bob', unprocessed_count: 1 },
    ]);
    mock_get_batches.mockResolvedValueOnce([make_batch()]);
    mock_format_prompt.mockReturnValue('prompt');
    mock_extract.mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED'));

    const result = await run_frf_pipeline();

    // Should not process second contact
    expect(result.contacts_processed).toBe(0);
    expect(result.errors).toBeGreaterThan(0);
    expect(mock_get_batches).toHaveBeenCalledTimes(1);
  });

  it('retries batch once on non-rate-limit API error', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
    ]);
    mock_get_batches.mockResolvedValueOnce([make_batch()]);
    mock_format_prompt.mockReturnValue('prompt');

    // First call fails, retry succeeds
    mock_extract
      .mockRejectedValueOnce(new Error('Internal server error'))
      .mockResolvedValueOnce({ facts: [], relationships: [], followups: [] });

    const result = await run_frf_pipeline();

    expect(mock_extract).toHaveBeenCalledTimes(2);
    expect(result.batches_processed).toBe(1);
  });

  it('skips batch after retry also fails', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
    ]);
    mock_get_batches.mockResolvedValueOnce([make_batch()]);
    mock_format_prompt.mockReturnValue('prompt');

    mock_extract
      .mockRejectedValueOnce(new Error('Server error'))
      .mockRejectedValueOnce(new Error('Server error again'));

    const result = await run_frf_pipeline();

    expect(result.batches_processed).toBe(0);
    expect(result.errors).toBeGreaterThan(0);
    expect(result.contacts_processed).toBe(1); // Contact still counted
  });

  it('continues with next contact on database error', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
      { contact_id: 'c2', contact_name: 'Bob', unprocessed_count: 1 },
    ]);

    mock_get_batches
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce([make_batch({ contact_id: 'c2', contact_name: 'Bob' })]);

    mock_format_prompt.mockReturnValue('prompt');
    mock_extract.mockResolvedValue({ facts: [], relationships: [], followups: [] });

    const result = await run_frf_pipeline();

    expect(result.contacts_processed).toBe(1); // Only Bob
    expect(result.errors).toBe(1); // Alice's DB error
  });

  it('increments errors when fact creation fails', async () => {
    mock_get_unprocessed.mockResolvedValueOnce([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 1 },
    ]);
    mock_get_batches.mockResolvedValueOnce([make_batch()]);
    mock_format_prompt.mockReturnValue('prompt');
    mock_extract.mockResolvedValueOnce({
      facts: [{ fact_type: 'company', value: 'Acme', confidence: 0.9 }],
      relationships: [],
      followups: [],
    });
    mock_create_fact.mockRejectedValueOnce(new Error('DB error'));

    const result = await run_frf_pipeline();

    expect(result.errors).toBe(1);
    expect(result.facts_created).toBe(0);
    // Batch should still be marked as processed
    expect(result.batches_processed).toBe(1);
  });
});

// ── Cron lifecycle ─────────────────────────────────────────────────────────

describe('start_frf_cron / stop_frf_cron', () => {
  afterEach(() => {
    stop_frf_cron(); // Clean up
  });

  it('registers a cron job with the configured interval', () => {
    start_frf_cron();

    expect(cron.validate).toHaveBeenCalledWith('*/30 * * * *');
    expect(cron.schedule).toHaveBeenCalledWith(
      '*/30 * * * *',
      expect.any(Function),
    );
  });

  it('does not register twice', () => {
    start_frf_cron();
    start_frf_cron();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  it('stops the cron task', () => {
    const mock_stop = vi.fn();
    vi.mocked(cron.schedule).mockReturnValueOnce({ stop: mock_stop } as any);

    start_frf_cron();
    stop_frf_cron();

    expect(mock_stop).toHaveBeenCalledOnce();
  });

  it('stop is safe to call when not started', () => {
    expect(() => stop_frf_cron()).not.toThrow();
  });
});
