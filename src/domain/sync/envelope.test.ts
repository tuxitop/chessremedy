import { describe, expect, it } from 'vitest';
import type { AnalysisJob } from '@/domain/analysis';
import type { MoveAnalysis } from '@/domain/chess';
import type { PuzzleRow } from '@/domain/puzzle';
import type { PuzzleAttemptRow, TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training';
import type { PuzzleCandidateRow } from '@/infrastructure/db/candidates-repository';
import type { SettingRow } from '@/infrastructure/db/database';
import type { GameRow } from '@/infrastructure/db/games-repository';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import {
  ENVELOPE_MIGRATIONS,
  applyEnvelopeMigrations,
  migrateEnvelope,
  parseEnvelope,
  serializeEnvelope,
  validateEnvelope,
  type EnvelopeMigrationRegistry,
} from './envelope';
import { makeTombstone } from './tombstone';
import type { SyncEnvelopeV1 } from './types';

function game(id: string, extra: Record<string, unknown> = {}): GameRow {
  return { id, updatedAt: 1, ...extra } as unknown as GameRow;
}

function baseEnvelope(games: GameRow[]): SyncEnvelopeV1 {
  return {
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    deviceId: 'device-a',
    collections: {
      games,
      analysis: {
        analyses: [{ analysisId: 'a1', ply: 0, analyzedAt: 1 } as unknown as MoveAnalysis],
        analysisJobs: [{ id: 'j1', updatedAt: 1 } as unknown as AnalysisJob],
        analysisSummaries: [{ analysisId: 'a1', updatedAt: 1 } as unknown as AnalysisSummaryRow],
        puzzleCandidates: [
          { analysisId: 'a1', sourcePly: 0, createdAt: 1 } as unknown as PuzzleCandidateRow,
        ],
      },
      puzzles: [{ sourceGameId: 'g1', sourcePly: 0, createdAt: 1 } as unknown as PuzzleRow],
      trainingSets: [{ id: 's1', updatedAt: 1 } as unknown as TacticalTrainingSetRow],
      trainingCycles: [{ id: 'c1', startedAt: 1 } as unknown as TrainingCycleRow],
      puzzleAttempts: [
        {
          cycleId: 'c1',
          puzzleId: 'g1:0',
          presentationIndex: 1,
          endedAt: 1,
        } as unknown as PuzzleAttemptRow,
      ],
      settings: [{ key: 'theme', value: 'dark', updatedAt: 1 } as unknown as SettingRow],
      tombstones: [makeTombstone('game', 'gone', 1, 'device-a')],
    },
  };
}

describe('serializeEnvelope', () => {
  it('is canonical and stable regardless of collection/record/key order', () => {
    const first = baseEnvelope([
      game('g1', { meta: { b: 1, a: 2 } }),
      game('g2', { meta: { a: 2, b: 1 } }),
    ]);
    const second = baseEnvelope([
      { meta: { a: 2, b: 1 }, updatedAt: 1, id: 'g2' } as unknown as GameRow,
      { updatedAt: 1, meta: { b: 1, a: 2 }, id: 'g1' } as unknown as GameRow,
    ]);
    const serialized = serializeEnvelope(first);
    expect(serialized).toBe(serializeEnvelope(second));
    expect(serialized.indexOf('"g1"')).toBeLessThan(serialized.indexOf('"g2"'));
  });

  it('round-trips through parseEnvelope', () => {
    const envelope = baseEnvelope([game('g1'), game('g2')]);
    const parsed = parseEnvelope(serializeEnvelope(envelope));
    expect(parsed.version).toBe(1);
    expect(parsed.deviceId).toBe('device-a');
    expect(parsed.collections.games.map((record) => record.id)).toEqual(['g1', 'g2']);
    expect(parsed.collections.tombstones).toEqual([makeTombstone('game', 'gone', 1, 'device-a')]);
  });
});

describe('parseEnvelope / migrateEnvelope', () => {
  it('rejects an unknown (newer) payload version', () => {
    const payload = JSON.stringify({ version: 2, exportedAt: 'x', deviceId: 'd', collections: {} });
    expect(() => parseEnvelope(payload)).toThrow(/version 2/);
  });

  it('rejects malformed JSON and non-object payloads', () => {
    expect(() => parseEnvelope('not json')).toThrow(/JSON/);
    expect(() => parseEnvelope('[]')).toThrow(/object/);
  });

  it('accepts the current version with the empty v1 migration registry', () => {
    expect(Object.keys(ENVELOPE_MIGRATIONS)).toEqual([]);
    const envelope = migrateEnvelope({
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      deviceId: 'device-a',
      collections: {},
    });
    expect(envelope.collections.games).toEqual([]);
    expect(envelope.collections.tombstones).toEqual([]);
  });

  it('composes registered migrations in sequence', () => {
    const calls: number[] = [];
    const registry: EnvelopeMigrationRegistry = {
      1: (raw) => {
        calls.push(1);
        return { ...raw, one: true };
      },
      2: (raw) => {
        calls.push(2);
        return { ...raw, two: true };
      },
    };
    const migrated = applyEnvelopeMigrations({ version: 1 }, 1, 3, registry);
    expect(calls).toEqual([1, 2]);
    expect(migrated).toMatchObject({ one: true, two: true });
  });

  it('throws when a required migration is missing', () => {
    expect(() => applyEnvelopeMigrations({ version: 1 }, 1, 2, {})).toThrow(/migration/);
  });
});

describe('validateEnvelope', () => {
  it('rejects a missing deviceId and a malformed tombstone', () => {
    expect(() =>
      validateEnvelope({ version: 1, exportedAt: 'x', deviceId: '', collections: {} }),
    ).toThrow(/deviceId/);

    expect(() =>
      validateEnvelope({
        version: 1,
        exportedAt: 'x',
        deviceId: 'd',
        collections: { tombstones: [{ id: 't', kind: 'user', recordId: 'r', deletedAt: 1 }] },
      }),
    ).toThrow(/kind/);
  });
});
