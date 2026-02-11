import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  get_pool: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    frf_followup_cutoff_days: 90,
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

import { is_within_followup_cutoff } from './followups.js';

describe('is_within_followup_cutoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for timestamps within cutoff period', () => {
    // 30 days ago is within 90-day cutoff
    const timestamp = new Date('2024-05-16T12:00:00Z');
    expect(is_within_followup_cutoff(timestamp, 90)).toBe(true);
  });

  it('returns true for timestamps exactly at cutoff boundary', () => {
    // Exactly 90 days ago
    const timestamp = new Date('2024-03-17T12:00:00Z');
    expect(is_within_followup_cutoff(timestamp, 90)).toBe(true);
  });

  it('returns false for timestamps beyond cutoff period', () => {
    // 91 days ago is beyond 90-day cutoff
    const timestamp = new Date('2024-03-16T11:00:00Z');
    expect(is_within_followup_cutoff(timestamp, 90)).toBe(false);
  });

  it('returns true for recent timestamps', () => {
    const timestamp = new Date('2024-06-14T12:00:00Z');
    expect(is_within_followup_cutoff(timestamp, 90)).toBe(true);
  });

  it('returns true for today', () => {
    const timestamp = new Date('2024-06-15T12:00:00Z');
    expect(is_within_followup_cutoff(timestamp, 90)).toBe(true);
  });

  it('respects custom cutoff days', () => {
    // 10 days ago with 7-day cutoff
    const timestamp = new Date('2024-06-05T12:00:00Z');
    expect(is_within_followup_cutoff(timestamp, 7)).toBe(false);

    // 5 days ago with 7-day cutoff
    const recent = new Date('2024-06-10T12:00:00Z');
    expect(is_within_followup_cutoff(recent, 7)).toBe(true);
  });
});
