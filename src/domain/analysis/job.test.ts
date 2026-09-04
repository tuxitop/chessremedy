import { describe, expect, it } from 'vitest';
import type { EngineMetadata } from '@/domain/chess';
import {
  analysisJobId,
  createAnalysisJob,
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
});

describe('analysis job state machine', () => {
  it('creates a queued job with zero progress', () => {
    const job = createAnalysisJob('lichess:abc', ENGINE, 40, 100);
    expect(job.state).toBe('queued');
    expect(job.completedPositions).toBe(0);
    expect(job.totalPositions).toBe(40);
    expect(job.startedAt).toBeNull();
    expect(job.id).toBe(analysisJobId('lichess:abc', ENGINE));
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

  it('creates a fresh job when none exists', () => {
    const job = jobForRun(undefined, 'lichess:abc', ENGINE, 40, 100);
    expect(job.state).toBe('queued');
    expect(job.id).toBe(analysisJobId('lichess:abc', ENGINE));
  });
});
