import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/index.js';
import {
  get_unprocessed_contacts,
  get_contact_batches,
  split_into_batches,
  format_message,
  format_batch_prompt,
  type BatchCommunication,
} from './batching.js';

const mock_query = vi.mocked(query);

function make_message(overrides: Partial<BatchCommunication> = {}): BatchCommunication {
  return {
    id: overrides.id ?? 'msg-1',
    content: overrides.content ?? 'This is a test message with enough length',
    source: overrides.source ?? 'imessage',
    direction: overrides.direction ?? 'inbound',
    subject: overrides.subject ?? null,
    timestamp: overrides.timestamp ?? new Date('2024-01-15T10:30:00Z'),
    contact_id: overrides.contact_id ?? 'contact-1',
    contact_name: overrides.contact_name ?? 'Alice',
  };
}

function make_messages(count: number): BatchCommunication[] {
  return Array.from({ length: count }, (_, i) =>
    make_message({
      id: `msg-${i + 1}`,
      timestamp: new Date(`2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── get_unprocessed_contacts ───────────────────────────────────────────────

describe('get_unprocessed_contacts', () => {
  it('returns contacts with unprocessed counts', async () => {
    mock_query.mockResolvedValueOnce({
      rows: [
        { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: '12' },
        { contact_id: 'c2', contact_name: 'Bob', unprocessed_count: '5' },
      ],
      rowCount: 2,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const contacts = await get_unprocessed_contacts();

    expect(contacts).toEqual([
      { contact_id: 'c1', contact_name: 'Alice', unprocessed_count: 12 },
      { contact_id: 'c2', contact_name: 'Bob', unprocessed_count: 5 },
    ]);
    expect(mock_query).toHaveBeenCalledOnce();
    expect(mock_query.mock.calls[0][0]).toContain('frf_processed_at IS NULL');
  });

  it('returns empty array when no contacts have unprocessed messages', async () => {
    mock_query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const contacts = await get_unprocessed_contacts();
    expect(contacts).toEqual([]);
  });
});

// ── split_into_batches (pure function) ─────────────────────────────────────

describe('split_into_batches', () => {
  it('returns empty array for no messages', () => {
    const batches = split_into_batches([], 5, 2);
    expect(batches).toEqual([]);
  });

  it('creates a single batch when messages fit within batch_size', () => {
    const messages = make_messages(5);
    const batches = split_into_batches(messages, 10, 2);

    expect(batches).toHaveLength(1);
    expect(batches[0].batch_messages).toHaveLength(5);
    expect(batches[0].communication_ids).toHaveLength(5);
  });

  it('creates a single batch for exactly one message', () => {
    const messages = make_messages(1);
    const batches = split_into_batches(messages, 15, 3);

    expect(batches).toHaveLength(1);
    expect(batches[0].batch_messages).toHaveLength(1);
    expect(batches[0].communication_ids).toEqual(['msg-1']);
  });

  it('splits messages into multiple batches', () => {
    const messages = make_messages(10);
    const batches = split_into_batches(messages, 5, 0);

    expect(batches).toHaveLength(2);
    expect(batches[0].batch_messages).toHaveLength(5);
    expect(batches[1].batch_messages).toHaveLength(5);
  });

  it('applies overlap correctly between batches', () => {
    const messages = make_messages(10);
    const batches = split_into_batches(messages, 5, 2);

    // First batch: messages 1-5
    expect(batches[0].batch_messages.map((m) => m.id)).toEqual([
      'msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5',
    ]);
    expect(batches[0].communication_ids).toEqual([
      'msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5',
    ]);

    // Second batch: messages 4-10 (overlap of 2 from batch 1, then 5 new)
    expect(batches[1].batch_messages.map((m) => m.id)).toEqual([
      'msg-4', 'msg-5', 'msg-6', 'msg-7', 'msg-8', 'msg-9', 'msg-10',
    ]);
    // Only the new messages (6-10) should be in communication_ids
    expect(batches[1].communication_ids).toEqual([
      'msg-6', 'msg-7', 'msg-8', 'msg-9', 'msg-10',
    ]);
  });

  it('does not double-count overlapped messages in communication_ids', () => {
    const messages = make_messages(20);
    const batches = split_into_batches(messages, 7, 3);

    const all_ids = batches.flatMap((b) => b.communication_ids);
    const unique_ids = new Set(all_ids);
    expect(all_ids.length).toBe(unique_ids.size);
    expect(unique_ids.size).toBe(20);
  });

  it('sets contact_id and contact_name from messages', () => {
    const messages = make_messages(3);
    const batches = split_into_batches(messages, 5, 1);

    expect(batches[0].contact_id).toBe('contact-1');
    expect(batches[0].contact_name).toBe('Alice');
  });

  it('initializes context_messages as empty array', () => {
    const messages = make_messages(3);
    const batches = split_into_batches(messages, 5, 1);

    expect(batches[0].context_messages).toEqual([]);
  });
});

// ── get_contact_batches ────────────────────────────────────────────────────

describe('get_contact_batches', () => {
  it('fetches context and unprocessed messages and builds batches', async () => {
    const context = [
      make_message({ id: 'ctx-1', timestamp: new Date('2024-01-01T10:00:00Z') }),
    ];
    const unprocessed = make_messages(5);

    // First call: context messages (reversed since query returns DESC)
    mock_query.mockResolvedValueOnce({
      rows: [...context],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    // Second call: unprocessed messages
    mock_query.mockResolvedValueOnce({
      rows: unprocessed,
      rowCount: 5,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const batches = await get_contact_batches('contact-1', 15, 3, 10);

    expect(batches).toHaveLength(1);
    expect(batches[0].context_messages).toHaveLength(1);
    expect(batches[0].batch_messages).toHaveLength(5);
    expect(batches[0].communication_ids).toHaveLength(5);
  });

  it('works with no context messages', async () => {
    mock_query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    mock_query.mockResolvedValueOnce({
      rows: make_messages(3),
      rowCount: 3,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const batches = await get_contact_batches('contact-1');

    expect(batches).toHaveLength(1);
    expect(batches[0].context_messages).toEqual([]);
    expect(batches[0].batch_messages).toHaveLength(3);
  });

  it('returns empty array when there are no unprocessed messages', async () => {
    mock_query.mockResolvedValueOnce({
      rows: [make_message({ id: 'ctx-1' })],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    mock_query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const batches = await get_contact_batches('contact-1');
    expect(batches).toEqual([]);
  });

  it('attaches the same context messages to all batches', async () => {
    // Query returns DESC order, code reverses to chronological
    const context_desc = [make_message({ id: 'ctx-2' }), make_message({ id: 'ctx-1' })];

    mock_query.mockResolvedValueOnce({
      rows: context_desc,
      rowCount: 2,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    mock_query.mockResolvedValueOnce({
      rows: make_messages(20),
      rowCount: 20,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const batches = await get_contact_batches('contact-1', 10, 2, 5);

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.context_messages).toHaveLength(2);
      expect(batch.context_messages[0].id).toBe('ctx-1');
    }
  });
});

// ── format_message ─────────────────────────────────────────────────────────

describe('format_message', () => {
  it('formats a basic inbound iMessage', () => {
    const msg = make_message({
      content: 'Hey, I just switched jobs!',
      source: 'imessage',
      direction: 'inbound',
      timestamp: new Date('2024-01-15T10:30:00Z'),
    });

    const formatted = format_message(msg);
    expect(formatted).toBe('[2024-01-15 10:30 | IMESSAGE | RECEIVED] Hey, I just switched jobs!');
  });

  it('formats an outbound email with subject', () => {
    const msg = make_message({
      content: 'Here is the report you asked for.',
      source: 'email',
      direction: 'outbound',
      subject: 'Project update',
      timestamp: new Date('2024-01-16T09:00:00Z'),
    });

    const formatted = format_message(msg);
    expect(formatted).toBe(
      '[2024-01-16 09:00 | EMAIL | SENT] Subject: Project update\n' +
      'Here is the report you asked for.'
    );
  });

  it('uppercases the source', () => {
    const msg = make_message({ source: 'whatsapp' });
    const formatted = format_message(msg);
    expect(formatted).toContain('WHATSAPP');
  });

  it('maps inbound to RECEIVED and outbound to SENT', () => {
    const received = format_message(make_message({ direction: 'inbound' }));
    const sent = format_message(make_message({ direction: 'outbound' }));

    expect(received).toContain('RECEIVED');
    expect(sent).toContain('SENT');
  });
});

// ── format_batch_prompt ────────────────────────────────────────────────────

describe('format_batch_prompt', () => {
  it('includes context and new message sections', () => {
    const context = [make_message({ id: 'ctx', content: 'Old context message here' })];
    const batch = [make_message({ id: 'new', content: 'New message to extract from' })];

    const prompt = format_batch_prompt(context, batch, 'Alice');

    expect(prompt).toContain('=== CONTEXT ONLY - Do not extract facts from these messages ===');
    expect(prompt).toContain('Old context message here');
    expect(prompt).toContain('=== NEW MESSAGES - Extract facts from these messages ===');
    expect(prompt).toContain('New message to extract from');
  });

  it('omits context section when there are no context messages', () => {
    const batch = [make_message({ content: 'A brand new message to process' })];

    const prompt = format_batch_prompt([], batch, 'Alice');

    expect(prompt).not.toContain('CONTEXT ONLY');
    expect(prompt).toContain('=== NEW MESSAGES - Extract facts from these messages ===');
    expect(prompt).toContain('A brand new message to process');
  });

  it('formats multiple messages in order', () => {
    const batch = [
      make_message({ id: '1', content: 'First message in this batch', timestamp: new Date('2024-01-01T10:00:00Z') }),
      make_message({ id: '2', content: 'Second message in this batch', timestamp: new Date('2024-01-02T10:00:00Z') }),
    ];

    const prompt = format_batch_prompt([], batch, 'Alice');
    const first_pos = prompt.indexOf('First message');
    const second_pos = prompt.indexOf('Second message');

    expect(first_pos).toBeLessThan(second_pos);
  });
});
