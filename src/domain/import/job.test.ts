import { describe, expect, it } from 'vitest';
import {
  MAX_ERROR_SAMPLES,
  createImportJob,
  importJobId,
  jobForRun,
  markCompleted,
  markFailed,
  markPaused,
  patchJob,
} from './job';
import type { ImportJob } from './job';
import { DEFAULT_IMPORT_FILTERS, type ImportFilters } from './filters';

const NOW = 1_750_000_000_000;

function baseJob(overrides?: Partial<ImportJob>): ImportJob {
  return {
    ...createImportJob('lichess', 'Carlsen', DEFAULT_IMPORT_FILTERS, NOW),
    ...overrides,
  };
}

const narrowFilters: ImportFilters = {
  timeFrame: { preset: 'all' },
  timeControls: { kind: 'categories', categories: ['blitz', 'rapid'] },
};

describe('job identity and creation', () => {
  it('derives a case-insensitive account id and keeps the typed username', () => {
    expect(importJobId('chesscom', '  ChessRemedy ')).toBe('chesscom:chessremedy');
    const job = createImportJob('chesscom', ' ChessRemedy ', DEFAULT_IMPORT_FILTERS, NOW);
    expect(job.id).toBe('chesscom:chessremedy');
    expect(job.username).toBe('ChessRemedy');
    expect(job.status).toBe('running');
    expect(job.cursor).toBeNull();
    expect(job.counters).toEqual({
      seen: 0,
      inserted: 0,
      updated: 0,
      duplicates: 0,
      failed: 0,
      skipped: 0,
      filtered: 0,
    });
    expect(job.startedAt).toBe(NOW);
    expect(job.completedAt).toBeNull();
  });
});

describe('jobForRun (incremental vs re-sweep)', () => {
  it('resumes from the stored cursor when filters are unchanged', () => {
    const stored = patchJob(baseJob(), { cursor: 'cc:2026/05' }, NOW);
    const next = jobForRun(stored, 'chesscom', 'ChessRemedy', DEFAULT_IMPORT_FILTERS, NOW + 1);
    expect(next.status).toBe('running');
    expect(next.cursor).toBe('cc:2026/05');
    expect(next.createdAt).toBe(stored.createdAt);
  });

  it('re-sweeps (resets cursor and counters) when filters differ', () => {
    const stored = patchJob(baseJob(), { cursor: 'since:123', addCounters: { inserted: 40 } }, NOW);
    const next = jobForRun(stored, 'lichess', 'Carlsen', narrowFilters, NOW + 1);
    expect(next.cursor).toBeNull();
    expect(next.counters.inserted).toBe(0);
    expect(next.filters).toEqual(narrowFilters);
    expect(next.status).toBe('running');
  });

  it('creates a fresh job when none is stored', () => {
    const job = jobForRun(undefined, 'lichess', 'carlsen', narrowFilters, NOW);
    expect(job.createdAt).toBe(NOW);
    expect(job.id).toBe('lichess:carlsen');
    expect(job.filters).toEqual(narrowFilters);
  });
});

describe('patchJob transitions', () => {
  it('accumulates counters', () => {
    let job = baseJob();
    job = patchJob(job, { addCounters: { seen: 5, inserted: 2 } }, NOW);
    job = patchJob(job, { addCounters: { seen: 1, duplicates: 3 } }, NOW);
    expect(job.counters).toEqual({ ...job.counters, seen: 6, inserted: 2, duplicates: 3 });
  });

  it('caps merged error samples', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      externalId: String(i),
      reason: `reason ${i}`,
    }));
    let job = baseJob();
    job = patchJob(job, { appendErrors: many }, NOW);
    expect(job.errorSamples).toHaveLength(MAX_ERROR_SAMPLES);
    expect(job.errorSamples[0]!.externalId).toBe('10');
    expect(job.errorSamples.at(-1)!.externalId).toBe('29');
  });

  it('marks paused, failed and completed with timestamps', () => {
    let job = baseJob();
    job = markPaused(job, NOW + 1);
    expect(job.status).toBe('paused');

    job = markFailed(job, 'rate-limited', NOW + 2);
    expect(job.status).toBe('failed');
    expect(job.lastError).toBe('rate-limited');
    expect(job.completedAt).toBe(NOW + 2);

    job = markCompleted(job, NOW + 3);
    expect(job.status).toBe('completed');
    expect(job.completedAt).toBe(NOW + 3);
  });

  it('updates the position and cursor', () => {
    const job = patchJob(baseJob(), { cursor: 'next', position: { current: 2, total: 5 } }, NOW);
    expect(job.cursor).toBe('next');
    expect(job.position).toEqual({ current: 2, total: 5 });
  });
});
