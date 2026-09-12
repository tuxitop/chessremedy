/**
 * Feature 016 — versioned envelope (domain, pure).
 *
 * `serializeEnvelope` emits the ADR-016 envelope with **canonical** ordering:
 * leaf collections and their records are sorted by their registry key, and
 * every object's keys are emitted in sorted order. The byte output is therefore
 * stable for logically equal data, which is what makes the Dropbox
 * `content_hash` comparison meaningful.
 *
 * `parseEnvelope` rejects an unknown `version`; `migrateEnvelope` applies the
 * versioned transform registry in sequence (empty at version 1, per ADR-016
 * Migration). `validateEnvelope` enforces the envelope-level shape.
 */

import type { AnalysisJob } from '@/domain/analysis';
import type { MoveAnalysis } from '@/domain/chess';
import type { PuzzleRow } from '@/domain/puzzle';
import type { PuzzleAttemptRow, TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training';
import type { PuzzleCandidateRow } from '@/infrastructure/db/candidates-repository';
import type { SettingRow } from '@/infrastructure/db/database';
import type { GameRow } from '@/infrastructure/db/games-repository';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import { SYNC_COLLECTION_BY_NAME } from './collections';
import {
  SYNC_PAYLOAD_VERSION,
  type SyncEnvelopeV1,
  type SyncTombstone,
  type TombstoneKind,
} from './types';

/** Transform one envelope object to the next payload version. */
export type EnvelopeMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Registry of version → transform. Key `n` migrates `n` to `n + 1`. */
export type EnvelopeMigrationRegistry = Readonly<Record<number, EnvelopeMigration>>;

/** No migration exists yet: version 1 is the current payload version. */
export const ENVELOPE_MIGRATIONS: EnvelopeMigrationRegistry = Object.freeze({});

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareStrings)) {
      result[key] = canonicalizeValue(record[key]);
    }
    return result;
  }
  return value;
}

function canonicalRecords<T>(records: readonly T[], keyOf: (record: T) => string): unknown[] {
  const sorted = [...records].sort((a, b) => compareStrings(keyOf(a), keyOf(b)));
  return sorted.map((record) => canonicalizeValue(record));
}

/**
 * Serialize an envelope to its canonical JSON form. Field/collection order is
 * fixed and every object key is sorted, so equal data always yields equal
 * bytes (and therefore the same content hash).
 */
export function serializeEnvelope(envelope: SyncEnvelopeV1): string {
  const { games, analysis, puzzles, trainingSets, trainingCycles, puzzleAttempts, settings } =
    envelope.collections;
  const canonical = {
    version: envelope.version,
    exportedAt: envelope.exportedAt,
    deviceId: envelope.deviceId,
    collections: {
      games: canonicalRecords(games, SYNC_COLLECTION_BY_NAME.games.keyOf),
      analysis: {
        analyses: canonicalRecords(analysis.analyses, SYNC_COLLECTION_BY_NAME.analyses.keyOf),
        analysisJobs: canonicalRecords(
          analysis.analysisJobs,
          SYNC_COLLECTION_BY_NAME.analysisJobs.keyOf,
        ),
        analysisSummaries: canonicalRecords(
          analysis.analysisSummaries,
          SYNC_COLLECTION_BY_NAME.analysisSummaries.keyOf,
        ),
        puzzleCandidates: canonicalRecords(
          analysis.puzzleCandidates,
          SYNC_COLLECTION_BY_NAME.puzzleCandidates.keyOf,
        ),
      },
      puzzles: canonicalRecords(puzzles, SYNC_COLLECTION_BY_NAME.puzzles.keyOf),
      trainingSets: canonicalRecords(trainingSets, SYNC_COLLECTION_BY_NAME.trainingSets.keyOf),
      trainingCycles: canonicalRecords(
        trainingCycles,
        SYNC_COLLECTION_BY_NAME.trainingCycles.keyOf,
      ),
      puzzleAttempts: canonicalRecords(
        puzzleAttempts,
        SYNC_COLLECTION_BY_NAME.puzzleAttempts.keyOf,
      ),
      settings: canonicalRecords(settings, SYNC_COLLECTION_BY_NAME.settings.keyOf),
      tombstones: canonicalRecords(
        envelope.collections.tombstones,
        (tombstone: SyncTombstone) => tombstone.id,
      ),
    },
  };
  return JSON.stringify(canonical);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readCollection(container: Record<string, unknown>, field: string): unknown[] {
  const value = container[field];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Sync envelope collection "${field}" must be an array.`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Sync envelope field "${field}" must be a non-empty string.`);
  }
  return value;
}

function validateTombstone(value: unknown, index: number): SyncTombstone {
  if (!isRecord(value)) {
    throw new Error(`Sync tombstone at index ${index} must be an object.`);
  }
  const kind = value.kind;
  if (kind !== 'game' && kind !== 'trainingSet') {
    throw new Error(`Sync tombstone at index ${index} has an invalid kind: ${String(kind)}.`);
  }
  const deletedAt = value.deletedAt;
  if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt)) {
    throw new Error(`Sync tombstone at index ${index} has an invalid deletedAt.`);
  }
  return {
    id: requireNonEmptyString(value.id, `tombstones[${index}].id`),
    kind: kind as TombstoneKind,
    recordId: requireNonEmptyString(value.recordId, `tombstones[${index}].recordId`),
    deletedAt,
    deviceId: requireNonEmptyString(value.deviceId, `tombstones[${index}].deviceId`),
  };
}

/** Validate the envelope-level shape and return a typed envelope. */
export function validateEnvelope(raw: unknown): SyncEnvelopeV1 {
  if (!isRecord(raw)) {
    throw new Error('Sync payload must be a JSON object.');
  }
  if (raw.version !== SYNC_PAYLOAD_VERSION) {
    throw new Error(
      `Unsupported sync payload version: ${String(raw.version)} (expected ${SYNC_PAYLOAD_VERSION}).`,
    );
  }
  const exportedAt = requireNonEmptyString(raw.exportedAt, 'exportedAt');
  const deviceId = requireNonEmptyString(raw.deviceId, 'deviceId');
  const collections = raw.collections;
  if (!isRecord(collections)) {
    throw new Error('Sync payload is missing its "collections" object.');
  }
  const analysis = isRecord(collections.analysis) ? collections.analysis : {};

  return {
    version: SYNC_PAYLOAD_VERSION,
    exportedAt,
    deviceId,
    collections: {
      games: readCollection(collections, 'games') as GameRow[],
      analysis: {
        analyses: readCollection(analysis, 'analyses') as MoveAnalysis[],
        analysisJobs: readCollection(analysis, 'analysisJobs') as AnalysisJob[],
        analysisSummaries: readCollection(analysis, 'analysisSummaries') as AnalysisSummaryRow[],
        puzzleCandidates: readCollection(analysis, 'puzzleCandidates') as PuzzleCandidateRow[],
      },
      puzzles: readCollection(collections, 'puzzles') as PuzzleRow[],
      trainingSets: readCollection(collections, 'trainingSets') as TacticalTrainingSetRow[],
      trainingCycles: readCollection(collections, 'trainingCycles') as TrainingCycleRow[],
      puzzleAttempts: readCollection(collections, 'puzzleAttempts') as PuzzleAttemptRow[],
      settings: readCollection(collections, 'settings') as SettingRow[],
      tombstones: readCollection(collections, 'tombstones').map(validateTombstone),
    },
  };
}

/**
 * Apply the registered transforms in sequence from `fromVersion` (exclusive
 * transform target start) to `toVersion`. Each registry key `n` transforms a
 * version-`n` payload into a version-`n + 1` payload.
 */
export function applyEnvelopeMigrations(
  raw: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
  registry: EnvelopeMigrationRegistry,
): Record<string, unknown> {
  let current = raw;
  for (let version = fromVersion; version < toVersion; version += 1) {
    const migration = registry[version];
    if (migration === undefined) {
      throw new Error(`No sync payload migration is registered from version ${version}.`);
    }
    current = migration(current);
  }
  return current;
}

/**
 * Migrate any understood payload version to the current one and validate it.
 * Rejects a version newer than this client understands (ADR-016).
 */
export function migrateEnvelope(
  raw: unknown,
  registry: EnvelopeMigrationRegistry = ENVELOPE_MIGRATIONS,
): SyncEnvelopeV1 {
  if (!isRecord(raw)) {
    throw new Error('Sync payload must be a JSON object.');
  }
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`Sync payload has an invalid version: ${String(version)}.`);
  }
  if (version > SYNC_PAYLOAD_VERSION) {
    throw new Error(
      `Unsupported sync payload version ${version}; this client understands up to ${SYNC_PAYLOAD_VERSION}.`,
    );
  }
  const migrated = applyEnvelopeMigrations(raw, version, SYNC_PAYLOAD_VERSION, registry);
  return validateEnvelope(migrated);
}

/** Parse JSON and migrate/validate it into a version-1 envelope. */
export function parseEnvelope(json: string): SyncEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Sync payload is not valid JSON.');
  }
  return migrateEnvelope(parsed);
}
