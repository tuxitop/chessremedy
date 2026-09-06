import { describe, expect, it } from 'vitest';
import type { EngineMetadata } from '@/domain/chess';
import type { AnalysisJob } from './job';
import { createAnalysisJob, markCancelled, markCompleted, markFailed } from './job';
import { analysisLibraryStatus, analysisStatusOf } from './status';

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

describe('analysisLibraryStatus (outdated detection)', () => {
  const CURRENT = {
    engineName: 'stockfish',
    engineVersion: '18.0.8',
    engineBuild: 'stockfish-18-lite-single',
  };

  function completedWith(engine: Partial<EngineMetadata>): AnalysisJob {
    const base = { ...ENGINE, ...engine };
    return markCompleted(createAnalysisJob('lichess:abc', base, 10, 1), 2);
  }

  it('reports completed when the analysis matches the current engine', () => {
    expect(analysisLibraryStatus([completedWith(ENGINE)], CURRENT)).toBe('completed');
  });

  it('reports outdated when a completed analysis predates the current engine', () => {
    const older = completedWith({
      engineVersion: '17.0.0',
      engineBuild: 'stockfish-17-lite-single',
    });
    expect(analysisLibraryStatus([older], CURRENT)).toBe('outdated');
  });

  it('reports outdated when versions are stale and keeps completed when unknown engine', () => {
    const stale = {
      ...markCompleted(createAnalysisJob('lichess:abc', ENGINE, 10, 1), 2),
      analysisVersion: 0,
    };
    expect(analysisLibraryStatus([stale], CURRENT)).toBe('outdated');
    // No current engine → version-only check still flags stale.
    expect(analysisLibraryStatus([stale], undefined)).toBe('outdated');
    const fresh = markCompleted(createAnalysisJob('lichess:abc', ENGINE, 10, 1), 2);
    expect(analysisLibraryStatus([fresh], undefined)).toBe('completed');
  });

  it('reports completed when a run matches the expected Game-analysis config', () => {
    const job = markCompleted(createAnalysisJob('lichess:abc', ENGINE, 10, 1), 2);
    expect(analysisLibraryStatus([job], CURRENT, { profile: 'normal' })).toBe('completed');
    const withOverride = markCompleted(
      createAnalysisJob('lichess:abc', ENGINE, 10, 1, { maxDepth: 25 }),
      2,
    );
    expect(
      analysisLibraryStatus([withOverride], CURRENT, {
        profile: 'normal',
        config: { maxDepth: 25 },
      }),
    ).toBe('completed');
  });

  it('reports outdated when the completed run predates the current Game-analysis config', () => {
    const plain = markCompleted(createAnalysisJob('lichess:abc', ENGINE, 10, 1), 2);
    // Current settings want a depth override → the plain run is outdated.
    expect(
      analysisLibraryStatus([plain], CURRENT, { profile: 'normal', config: { maxDepth: 25 } }),
    ).toBe('outdated');
    // Current settings use a different profile → the run is outdated.
    const deep = markCompleted(
      createAnalysisJob('lichess:abc', { ...ENGINE, profile: 'deep' }, 10, 1),
      2,
    );
    expect(analysisLibraryStatus([deep], CURRENT, { profile: 'normal' })).toBe('outdated');
    // When no expected config is supplied the check is disabled (legacy statuses).
    expect(analysisLibraryStatus([deep], CURRENT)).toBe('completed');
  });
});
