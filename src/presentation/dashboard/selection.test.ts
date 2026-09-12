import { describe, expect, it } from 'vitest';
import { aggregateOf, emptyAggregate } from '@/domain/statistics';
import type { PhaseMetricCounts, PhaseMetrics } from '@/domain/statistics';
import { setFixture } from '@/domain/training/test-support';
import {
  partitionKey,
  partitionOptions,
  selectDefaultPartition,
  selectDefaultTrainingSet,
  weakestPhase,
} from './selection';

describe('selectDefaultTrainingSet', () => {
  it('prefers the open block', () => {
    const block = setFixture({ id: 'block', updatedAt: 10 });
    const active = setFixture({ id: 'active', updatedAt: 999 });
    expect(selectDefaultTrainingSet([active], [], block)?.id).toBe('block');
  });

  it('picks the most recently updated active set when no block is open', () => {
    const older = setFixture({ id: 'older', updatedAt: 100 });
    const newer = setFixture({ id: 'newer', updatedAt: 200 });
    expect(selectDefaultTrainingSet([older, newer], [], undefined)?.id).toBe('newer');
  });

  it('breaks updatedAt ties by createdAt then id', () => {
    const a = setFixture({ id: 'a', updatedAt: 100, createdAt: 50 });
    const b = setFixture({ id: 'b', updatedAt: 100, createdAt: 60 });
    expect(selectDefaultTrainingSet([a, b], [], undefined)?.id).toBe('b');
  });

  it('falls back to the most recent archived set', () => {
    const archived = setFixture({ id: 'archived', updatedAt: 5, status: 'archived' });
    expect(selectDefaultTrainingSet([], [archived], undefined)?.id).toBe('archived');
  });

  it('returns null when there are no sets', () => {
    expect(selectDefaultTrainingSet([], [], undefined)).toBeNull();
  });
});

describe('partitionOptions', () => {
  it('preserves every concrete partition without merging', () => {
    const options = partitionOptions([
      { platform: 'lichess', timeControl: 'rapid', combined: false },
      { platform: 'chesscom', timeControl: 'blitz', combined: false },
    ]);
    expect(options.map((option) => option.value)).toEqual(['lichess:rapid', 'chesscom:blitz']);
    expect(options[0]?.label).toBe('Lichess · Rapid');
  });

  it('builds a stable partition key', () => {
    expect(partitionKey('chesscom', 'blitz')).toBe('chesscom:blitz');
  });
});

describe('selectDefaultPartition', () => {
  it('picks the concrete partition with the most games', () => {
    expect(
      selectDefaultPartition([
        { platform: 'lichess', timeControl: 'bullet', combined: false, gameCount: 2 },
        { platform: 'lichess', timeControl: 'rapid', combined: false, gameCount: 12 },
        { platform: 'chesscom', timeControl: 'blitz', combined: false, gameCount: 4 },
      ]),
    ).toBe('lichess:rapid');
  });

  it('breaks game-count ties by platform, then time control, then key', () => {
    expect(
      selectDefaultPartition([
        { platform: 'chesscom', timeControl: 'blitz', combined: false, gameCount: 5 },
        { platform: 'lichess', timeControl: 'rapid', combined: false, gameCount: 5 },
      ]),
    ).toBe('lichess:rapid');

    expect(
      selectDefaultPartition([
        { platform: 'lichess', timeControl: 'rapid', combined: false, gameCount: 5 },
        { platform: 'lichess', timeControl: 'bullet', combined: false, gameCount: 5 },
      ]),
    ).toBe('lichess:bullet');

    // Same platform + time control tie-break is not reachable with distinct
    // keys, but the key-ascending rule still yields a deterministic result.
    expect(
      selectDefaultPartition([
        { platform: 'local', timeControl: 'rapid', combined: false, gameCount: 5 },
        { platform: 'local', timeControl: 'blitz', combined: false, gameCount: 5 },
      ]),
    ).toBe('local:blitz');
  });

  it('excludes combined and fixture partitions and falls back to all', () => {
    expect(
      selectDefaultPartition([
        { platform: 'all', timeControl: 'all', combined: true, gameCount: 99 },
        { platform: 'fixture', timeControl: 'rapid', combined: false, gameCount: 50 },
      ]),
    ).toBe('all');
    expect(selectDefaultPartition([])).toBe('all');
  });

  it('never selects a fixture partition even when it has the most games', () => {
    expect(
      selectDefaultPartition([
        { platform: 'fixture', timeControl: 'rapid', combined: false, gameCount: 100 },
        { platform: 'lichess', timeControl: 'blitz', combined: false, gameCount: 3 },
      ]),
    ).toBe('lichess:blitz');
  });
});

function counts(
  values: Partial<Record<keyof PhaseMetricCounts, number | null>>,
): PhaseMetricCounts {
  const aggregate = (value: number | null | undefined): PhaseMetricCounts['inaccuracies'] =>
    value === null || value === undefined
      ? emptyAggregate('moves')
      : aggregateOf(value, 20, 'moves');
  return {
    inaccuracies: aggregate(values.inaccuracies),
    mistakes: aggregate(values.mistakes),
    blunders: aggregate(values.blunders),
    missedTactics: aggregate(values.missedTactics),
  };
}

function phase(
  name: PhaseMetrics['phase'],
  values: Partial<Record<keyof PhaseMetricCounts, number>>,
): PhaseMetrics {
  return {
    phase: name,
    userMovesInPhase: 100,
    detectedUserMovesInPhase: 100,
    counts: counts(values),
    errorsPer100Moves: counts(values),
  };
}

describe('weakestPhase', () => {
  it('labels the phase with the highest summed normalized rate', () => {
    const result = weakestPhase(
      [
        phase('opening', { inaccuracies: 1, mistakes: 0, blunders: 0 }),
        phase('middlegame', { inaccuracies: 3, mistakes: 2, blunders: 1 }),
        phase('endgame', { inaccuracies: 1, mistakes: 1, blunders: 0 }),
      ],
      'errorsPer100Moves',
    );
    expect(result).toBe('middlegame');
  });

  it('ignores phases with no available value', () => {
    const result = weakestPhase(
      [phase('opening', {}), phase('endgame', { blunders: 2 })],
      'counts',
    );
    expect(result).toBe('endgame');
  });

  it('returns null when every phase is empty', () => {
    expect(weakestPhase([phase('opening', {}), phase('endgame', {})])).toBeNull();
  });
});
