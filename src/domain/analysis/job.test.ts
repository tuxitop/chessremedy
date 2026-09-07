import { describe, expect, it } from 'vitest';
import type { EngineMetadata } from '@/domain/chess';
import {
  analysisJobId,
  createAnalysisJob,
  gameAnalysisConfigFingerprint,
  jobForRun,
  markCancelled,
  markCompleted,
  markFailed,
  markInProgress,
  markProgress,
} from './job';

const ENGINE: EngineMetadata = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
  profile: 'normal',
};

const FAST: EngineMetadata = { ...ENGINE, profile: 'fast' };

describe('analysis job identity', () => {
  it('is deterministic for the same game and configuration', () => {
    expect(analysisJobId('lichess:abc', ENGINE)).toBe(analysisJobId('lichess:abc', ENGINE));
  });

  it('distinguishes games, profiles, engine builds and versions', () => {
    const base = analysisJobId('lichess:abc', ENGINE);
    expect(analysisJobId('lichess:def', ENGINE)).not.toBe(base);
    expect(analysisJobId('lichess:abc', FAST)).not.toBe(base);
    expect(analysisJobId('lichess:abc', { ...ENGINE, engineVersion: '19.0.0' })).not.toBe(base);
    expect(analysisJobId('lichess:abc', { ...ENGINE, engineBuild: 'stockfish-18-lite' })).not.toBe(
      base,
    );
  });

  it('keeps the historical id when no Game-analysis overrides apply', () => {
    expect(analysisJobId('lichess:abc', ENGINE, undefined, undefined)).toBe(
      analysisJobId('lichess:abc', ENGINE),
    );
    expect(analysisJobId('lichess:abc', ENGINE, undefined, null)).toBe(
      analysisJobId('lichess:abc', ENGINE),
    );
    // An empty config object is not an override either.
    expect(analysisJobId('lichess:abc', ENGINE, undefined, {})).toBe(
      analysisJobId('lichess:abc', ENGINE),
    );
  });

  it('appends a deterministic fingerprint when depth/time/threads overrides apply', () => {
    const base = analysisJobId('lichess:abc', ENGINE);
    const depth = analysisJobId('lichess:abc', ENGINE, undefined, { maxDepth: 25 });
    const time = analysisJobId('lichess:abc', ENGINE, undefined, { movetimeMs: 5000 });
    const threads = analysisJobId('lichess:abc', ENGINE, undefined, { threads: 2 });
    const both = analysisJobId('lichess:abc', ENGINE, undefined, {
      maxDepth: 25,
      movetimeMs: 5000,
      threads: 2,
    });
    expect(depth).not.toBe(base);
    expect(time).not.toBe(base);
    expect(threads).not.toBe(base);
    expect(both).not.toBe(base);
    expect(both).not.toBe(depth);
    expect(both).not.toBe(time);
    // Order-stable: identical overrides produce identical ids regardless of
    // insertion order in the config object.
    expect(
      analysisJobId('lichess:abc', ENGINE, undefined, {
        threads: 2,
        maxDepth: 25,
        movetimeMs: 5000,
      }),
    ).toBe(both);
    expect(
      analysisJobId('lichess:abc', ENGINE, undefined, { maxDepth: 25, movetimeMs: 5000 }),
    ).toBe(
      analysisJobId('lichess:abc', ENGINE, undefined, {
        movetimeMs: 5000,
        maxDepth: 25,
      }),
    );
  });

  it('fingerprints depth/time/threads only, in a stable order', () => {
    expect(gameAnalysisConfigFingerprint(undefined)).toBeUndefined();
    expect(gameAnalysisConfigFingerprint({})).toBeUndefined();
    expect(gameAnalysisConfigFingerprint({ maxDepth: 25 })).toBe('d25');
    expect(gameAnalysisConfigFingerprint({ movetimeMs: 5000 })).toBe('t5000');
    expect(gameAnalysisConfigFingerprint({ threads: 2 })).toBe('n2');
    expect(gameAnalysisConfigFingerprint({ maxDepth: 25, movetimeMs: 5000 })).toBe('d25,t5000');
    expect(gameAnalysisConfigFingerprint({ maxDepth: 25, movetimeMs: 5000, threads: 2 })).toBe(
      'd25,t5000,n2',
    );
  });
});

describe('analysis job state machine', () => {
  it('creates a queued job with zero progress', () => {
    const job = createAnalysisJob('lichess:abc', ENGINE, 40, 100);
    expect(job.state).toBe('queued');
    expect(job.completedPositions).toBe(0);
    expect(job.totalPositions).toBe(40);
    expect(job.startedAt).toBeNull();
    expect(job.id).toBe(analysisJobId('lichess:abc', ENGINE));
    expect(job.config).toBeUndefined();
  });

  it('stores overrides on the job and reflects them in the id', () => {
    const job = createAnalysisJob('lichess:abc', ENGINE, 40, 100, { maxDepth: 25 });
    expect(job.config).toEqual({ maxDepth: 25 });
    expect(job.id).toBe(analysisJobId('lichess:abc', ENGINE, undefined, { maxDepth: 25 }));
    const noOverride = createAnalysisJob('lichess:abc', ENGINE, 40, 100, {});
    expect(noOverride.config).toBeUndefined();
    expect(noOverride.id).toBe(analysisJobId('lichess:abc', ENGINE));
  });

  it('transitions through inProgress/completed and records times', () => {
    let job = createAnalysisJob('lichess:abc', ENGINE, 2, 100);
    job = markInProgress(job, 110);
    expect(job.state).toBe('inProgress');
    expect(job.startedAt).toBe(110);
    job = markProgress(job, 1, 120);
    expect(job.completedPositions).toBe(1);
    job = markCompleted(job, 130);
    expect(job.state).toBe('completed');
    expect(job.completedAt).toBe(130);
  });

  it('marks failures and cancellations with reasons', () => {
    let job = createAnalysisJob('lichess:abc', ENGINE, 2, 100);
    job = markInProgress(job, 110);
    job = markFailed(job, 'Engine crashed', 120);
    expect(job.state).toBe('failed');
    expect(job.lastError).toBe('Engine crashed');
    expect(job.completedAt).toBe(120);

    const cancelled = markCancelled(createAnalysisJob('lichess:abc', ENGINE, 2, 100), 140);
    expect(cancelled.state).toBe('cancelled');
  });
});

describe('analysis job restart behaviour', () => {
  it('resumes an interrupted queued/inProgress job in place', () => {
    let stored = createAnalysisJob('lichess:abc', ENGINE, 40, 100);
    stored = markInProgress(stored, 105);
    stored = markProgress(stored, 12, 110);
    const resumed = jobForRun(stored, 'lichess:abc', ENGINE, 40, 200);
    expect(resumed.state).toBe('inProgress');
    expect(resumed.completedPositions).toBe(12);
    expect(resumed.id).toBe(stored.id);
  });

  it('returns a completed job unchanged (no duplicate work)', () => {
    const stored = markCompleted(createAnalysisJob('lichess:abc', ENGINE, 40, 100), 110);
    const again = jobForRun(stored, 'lichess:abc', ENGINE, 40, 200);
    expect(again).toBe(stored);
  });

  it('restarts a failed/cancelled job under the same deterministic id', () => {
    const failed = markFailed(createAnalysisJob('lichess:abc', ENGINE, 40, 100), 'boom', 110);
    const retried = jobForRun(failed, 'lichess:abc', ENGINE, 40, 200);
    expect(retried.state).toBe('queued');
    expect(retried.id).toBe(failed.id);
    expect(retried.createdAt).toBe(failed.createdAt);
    expect(retried.completedPositions).toBe(0);
  });

  it('preserves overrides when restarting a terminal job', () => {
    const failed = markFailed(
      createAnalysisJob('lichess:abc', ENGINE, 40, 100, { maxDepth: 30 }),
      'boom',
      110,
    );
    const retried = jobForRun(failed, 'lichess:abc', ENGINE, 40, 200);
    expect(retried.state).toBe('queued');
    expect(retried.id).toBe(failed.id);
    expect(retried.config).toEqual({ maxDepth: 30 });
  });

  it('creates a fresh job when none exists', () => {
    const job = jobForRun(undefined, 'lichess:abc', ENGINE, 40, 100);
    expect(job.state).toBe('queued');
    expect(job.id).toBe(analysisJobId('lichess:abc', ENGINE));
  });
});
