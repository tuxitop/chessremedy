import { describe, expect, it } from 'vitest';
import { puzzleIdOf } from '@/domain/puzzle';
import {
  SYNC_COLLECTION_BY_NAME,
  SYNC_COLLECTION_NAMES,
  SYNC_COLLECTION_SPECS,
  collectionNamesInGroup,
} from './collections';

const SAMPLES: Record<string, unknown> = {
  games: { id: 'g1', updatedAt: 5 },
  analyses: { analysisId: 'a1', ply: 3, analyzedAt: 10, updatedAt: 999 },
  analysisJobs: { id: 'j1', updatedAt: 11 },
  analysisSummaries: { analysisId: 'a1', updatedAt: 12 },
  puzzleCandidates: { analysisId: 'a1', sourcePly: 4, createdAt: 13 },
  puzzles: { sourceGameId: 'g1', sourcePly: 4, createdAt: 14 },
  trainingSets: { id: 's1', updatedAt: 15 },
  trainingCycles: { id: 'c1', startedAt: 16 },
  puzzleAttempts: {
    cycleId: 'c1',
    puzzleId: 'g1:4',
    presentationIndex: 1,
    endedAt: 17,
  },
  settings: { key: 'theme', updatedAt: 18 },
};

describe('sync collection registry', () => {
  it('registers every leaf name exactly once', () => {
    expect(SYNC_COLLECTION_SPECS.map((spec) => spec.name)).toEqual(SYNC_COLLECTION_NAMES);
    expect(new Set(SYNC_COLLECTION_NAMES).size).toBe(SYNC_COLLECTION_NAMES.length);
    for (const name of SYNC_COLLECTION_NAMES) {
      expect(SYNC_COLLECTION_BY_NAME[name].name).toBe(name);
    }
  });

  it('maps every leaf into the ADR-016 envelope group', () => {
    expect(collectionNamesInGroup('analysis')).toEqual([
      'analyses',
      'analysisJobs',
      'analysisSummaries',
      'puzzleCandidates',
    ]);
    expect(collectionNamesInGroup('games')).toEqual(['games']);
    expect(collectionNamesInGroup('settings')).toEqual(['settings']);
  });

  it('gives every collection a total, deterministic key and timestamp', () => {
    for (const spec of SYNC_COLLECTION_SPECS) {
      const sample = SAMPLES[spec.name];
      expect(sample).toBeDefined();
      const firstKey = spec.keyOf(sample);
      const secondKey = spec.keyOf(sample);
      const firstTimestamp = spec.updatedAtOf(sample);
      const secondTimestamp = spec.updatedAtOf(sample);
      expect(typeof firstKey).toBe('string');
      expect(firstKey.length).toBeGreaterThan(0);
      expect(firstKey).toBe(secondKey);
      expect(Number.isFinite(firstTimestamp)).toBe(true);
      expect(firstTimestamp).toBe(secondTimestamp);
    }
  });

  it('uses the canonical key shapes', () => {
    expect(SYNC_COLLECTION_BY_NAME.games.keyOf(SAMPLES.games)).toBe('g1');
    expect(SYNC_COLLECTION_BY_NAME.analyses.keyOf(SAMPLES.analyses)).toBe('a1:3');
    expect(SYNC_COLLECTION_BY_NAME.analysisSummaries.keyOf(SAMPLES.analysisSummaries)).toBe('a1');
    expect(SYNC_COLLECTION_BY_NAME.puzzleCandidates.keyOf(SAMPLES.puzzleCandidates)).toBe('a1:4');
    expect(SYNC_COLLECTION_BY_NAME.puzzles.keyOf(SAMPLES.puzzles)).toBe(puzzleIdOf('g1', 4));
    expect(SYNC_COLLECTION_BY_NAME.puzzleAttempts.keyOf(SAMPLES.puzzleAttempts)).toBe('c1:g1:4:1');
    expect(SYNC_COLLECTION_BY_NAME.settings.keyOf(SAMPLES.settings)).toBe('theme');
  });

  it('falls back to creation timestamps for immutable rows (G2)', () => {
    expect(SYNC_COLLECTION_BY_NAME.analyses.updatedAtOf(SAMPLES.analyses)).toBe(10);
    expect(SYNC_COLLECTION_BY_NAME.puzzles.updatedAtOf(SAMPLES.puzzles)).toBe(14);
    expect(SYNC_COLLECTION_BY_NAME.puzzleAttempts.updatedAtOf(SAMPLES.puzzleAttempts)).toBe(17);
  });

  it('reads a stored updatedAt when present and falls back otherwise', () => {
    const candidateSpec = SYNC_COLLECTION_BY_NAME.puzzleCandidates;
    expect(candidateSpec.updatedAtOf({ analysisId: 'a1', sourcePly: 0, createdAt: 13 })).toBe(13);
    expect(
      candidateSpec.updatedAtOf({ analysisId: 'a1', sourcePly: 0, createdAt: 13, updatedAt: 99 }),
    ).toBe(99);

    const cycleSpec = SYNC_COLLECTION_BY_NAME.trainingCycles;
    expect(cycleSpec.updatedAtOf({ id: 'c1', startedAt: 16 })).toBe(16);
    expect(cycleSpec.updatedAtOf({ id: 'c1', startedAt: 16, updatedAt: 77 })).toBe(77);
  });

  it('marks only games and trainingSets as tombstone-owned', () => {
    const owned = SYNC_COLLECTION_SPECS.filter((spec) => spec.tombstoneKind !== null).map(
      (spec) => [spec.name, spec.tombstoneKind],
    );
    expect(owned).toEqual([
      ['games', 'game'],
      ['trainingSets', 'trainingSet'],
    ]);
  });

  it('throws a descriptive error when a required field is missing', () => {
    expect(() => SYNC_COLLECTION_BY_NAME.games.keyOf({ updatedAt: 1 })).toThrow(/id/);
  });
});
