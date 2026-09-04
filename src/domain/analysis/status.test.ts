import { describe, expect, it } from 'vitest';
import type { EngineMetadata } from '@/domain/chess';
import type { AnalysisJob } from './job';
import { createAnalysisJob, markCancelled, markCompleted, markFailed } from './job';
import { analysisStatusOf } from './status';

const ENGINE: EngineMetadata = {
  engineName: 'stockfish',
  engineVersion: '18.0.8',
  engineBuild: 'stockfish-18-lite-single',
  profile: 'normal',
};

function job(state: 'queued' | 'inProgress' | 'completed' | 'cancelled' | 'failed'): AnalysisJob {
  let j = createAnalysisJob('lichess:abc', ENGINE, 10, 1);
  switch (state) {
    case 'queued':
      return j;
    case 'inProgress':
      j = { ...j, state: 'inProgress' as const };
      return j;
    case 'completed':
      return markCompleted(j, 2);
    case 'cancelled':
      return markCancelled(j, 2);
    case 'failed':
      return markFailed(j, 'boom', 2);
  }
}

describe('analysisStatusOf (Game Library status)', () => {
  it('is unanalyzed when no job exists', () => {
    expect(analysisStatusOf([])).toBe('unanalyzed');
  });

  it('surfaces an active run ahead of any completed analysis', () => {
    expect(analysisStatusOf([job('inProgress')])).toBe('inProgress');
    expect(analysisStatusOf([job('queued')])).toBe('queued');
    expect(analysisStatusOf([job('completed'), job('inProgress')])).toBe('inProgress');
  });

  it('reports completed once an analysis exists and nothing is active', () => {
    expect(analysisStatusOf([job('completed')])).toBe('completed');
    expect(analysisStatusOf([job('failed'), job('completed')])).toBe('completed');
  });

  it('falls back to failed then cancelled when nothing ever completed', () => {
    expect(analysisStatusOf([job('failed')])).toBe('failed');
    expect(analysisStatusOf([job('cancelled'), job('failed')])).toBe('failed');
    expect(analysisStatusOf([job('cancelled')])).toBe('cancelled');
  });
});
