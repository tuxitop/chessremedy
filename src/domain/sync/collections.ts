/**
 * Feature 016 — leaf-collection registry (domain, pure).
 *
 * One entry per leaf array of the ADR-016 envelope: the collection name, its
 * envelope group, the stable `keyOf` used for record matching/canonical
 * ordering, and the effective `updatedAtOf` used by the ADR-017 last-write-wins
 * merge. `tombstoneKind` records ownership: only `games` and `trainingSets`
 * are directly tombstoned; derived rows are removed by the ownership cascade
 * (spec "Deletion & derived state").
 *
 * `updatedAtOf` (plan §6.2, G2): mutable rows carry a real `updatedAt`;
 * immutable add-only rows use their canonical creation timestamp. The two
 * mutable collections that do not yet carry a stored `updatedAt`
 * (`puzzleCandidates`, `trainingCycles`) read it when present and fall back to
 * their creation timestamp (`createdAt` / `startedAt`) until schema v12 adds
 * the field. No other file is touched.
 */

import { puzzleIdOf } from '@/domain/puzzle';
import type { SyncCollectionGroup, SyncCollectionName, TombstoneKind } from './types';

/** One leaf collection of the sync envelope. */
export interface SyncCollectionSpec {
  readonly name: SyncCollectionName;
  readonly group: SyncCollectionGroup;
  /** Stable record key used for matching, merging and canonical ordering. */
  readonly keyOf: (record: unknown) => string;
  /** Effective ADR-017 merge timestamp (real or creation timestamp). */
  readonly updatedAtOf: (record: unknown) => number;
  /** Kind of tombstone that deletes this collection's records, if any. */
  readonly tombstoneKind: TombstoneKind | null;
}

/** Ordered leaf names of the envelope (deterministic serialization order). */
export const SYNC_COLLECTION_NAMES: readonly SyncCollectionName[] = [
  'games',
  'analyses',
  'analysisJobs',
  'analysisSummaries',
  'puzzleCandidates',
  'puzzles',
  'trainingSets',
  'trainingCycles',
  'puzzleAttempts',
  'settings',
];

function readField(record: unknown, field: string): unknown {
  if (record === null || typeof record !== 'object') {
    return undefined;
  }
  return (record as Record<string, unknown>)[field];
}

function requireString(record: unknown, field: string): string {
  const value = readField(record, field);
  if (typeof value !== 'string') {
    throw new Error(`Sync record is missing required string field "${field}".`);
  }
  return value;
}

function requireFiniteNumber(record: unknown, field: string): number {
  const value = readField(record, field);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Sync record is missing required numeric field "${field}".`);
  }
  return value;
}

/** Stored `updatedAt` when present, else the collection's creation timestamp. */
function updatedAtOr(record: unknown, fallbackField: string): number {
  const value = readField(record, 'updatedAt');
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return requireFiniteNumber(record, fallbackField);
}

const GAMES_SPEC: SyncCollectionSpec = {
  name: 'games',
  group: 'games',
  keyOf: (record) => requireString(record, 'id'),
  updatedAtOf: (record) => requireFiniteNumber(record, 'updatedAt'),
  tombstoneKind: 'game',
};

const ANALYSES_SPEC: SyncCollectionSpec = {
  name: 'analyses',
  group: 'analysis',
  keyOf: (record) => `${requireString(record, 'analysisId')}:${requireFiniteNumber(record, 'ply')}`,
  updatedAtOf: (record) => requireFiniteNumber(record, 'analyzedAt'),
  tombstoneKind: null,
};

const ANALYSIS_JOBS_SPEC: SyncCollectionSpec = {
  name: 'analysisJobs',
  group: 'analysis',
  keyOf: (record) => requireString(record, 'id'),
  updatedAtOf: (record) => requireFiniteNumber(record, 'updatedAt'),
  tombstoneKind: null,
};

const ANALYSIS_SUMMARIES_SPEC: SyncCollectionSpec = {
  name: 'analysisSummaries',
  group: 'analysis',
  keyOf: (record) => requireString(record, 'analysisId'),
  updatedAtOf: (record) => requireFiniteNumber(record, 'updatedAt'),
  tombstoneKind: null,
};

const PUZZLE_CANDIDATES_SPEC: SyncCollectionSpec = {
  name: 'puzzleCandidates',
  group: 'analysis',
  keyOf: (record) =>
    `${requireString(record, 'analysisId')}:${requireFiniteNumber(record, 'sourcePly')}`,
  updatedAtOf: (record) => updatedAtOr(record, 'createdAt'),
  tombstoneKind: null,
};

const PUZZLES_SPEC: SyncCollectionSpec = {
  name: 'puzzles',
  group: 'puzzles',
  keyOf: (record) =>
    puzzleIdOf(requireString(record, 'sourceGameId'), requireFiniteNumber(record, 'sourcePly')),
  updatedAtOf: (record) => requireFiniteNumber(record, 'createdAt'),
  tombstoneKind: null,
};

const TRAINING_SETS_SPEC: SyncCollectionSpec = {
  name: 'trainingSets',
  group: 'trainingSets',
  keyOf: (record) => requireString(record, 'id'),
  updatedAtOf: (record) => requireFiniteNumber(record, 'updatedAt'),
  tombstoneKind: 'trainingSet',
};

const TRAINING_CYCLES_SPEC: SyncCollectionSpec = {
  name: 'trainingCycles',
  group: 'trainingCycles',
  keyOf: (record) => requireString(record, 'id'),
  updatedAtOf: (record) => updatedAtOr(record, 'startedAt'),
  tombstoneKind: null,
};

const PUZZLE_ATTEMPTS_SPEC: SyncCollectionSpec = {
  name: 'puzzleAttempts',
  group: 'puzzleAttempts',
  keyOf: (record) =>
    `${requireString(record, 'cycleId')}:${requireString(record, 'puzzleId')}:${requireFiniteNumber(
      record,
      'presentationIndex',
    )}`,
  updatedAtOf: (record) => requireFiniteNumber(record, 'endedAt'),
  tombstoneKind: null,
};

const SETTINGS_SPEC: SyncCollectionSpec = {
  name: 'settings',
  group: 'settings',
  keyOf: (record) => requireString(record, 'key'),
  updatedAtOf: (record) => requireFiniteNumber(record, 'updatedAt'),
  tombstoneKind: null,
};

/** The complete leaf-collection registry, in canonical envelope order. */
export const SYNC_COLLECTION_SPECS: readonly SyncCollectionSpec[] = [
  GAMES_SPEC,
  ANALYSES_SPEC,
  ANALYSIS_JOBS_SPEC,
  ANALYSIS_SUMMARIES_SPEC,
  PUZZLE_CANDIDATES_SPEC,
  PUZZLES_SPEC,
  TRAINING_SETS_SPEC,
  TRAINING_CYCLES_SPEC,
  PUZZLE_ATTEMPTS_SPEC,
  SETTINGS_SPEC,
];

function indexSpecs(
  specs: readonly SyncCollectionSpec[],
): Readonly<Record<SyncCollectionName, SyncCollectionSpec>> {
  const index = {} as Record<SyncCollectionName, SyncCollectionSpec>;
  for (const spec of specs) {
    index[spec.name] = spec;
  }
  return index;
}

/** Registry lookup by leaf name. */
export const SYNC_COLLECTION_BY_NAME: Readonly<Record<SyncCollectionName, SyncCollectionSpec>> =
  indexSpecs(SYNC_COLLECTION_SPECS);

/** The leaf names of one envelope group, in canonical order. */
export function collectionNamesInGroup(group: SyncCollectionGroup): readonly SyncCollectionName[] {
  return SYNC_COLLECTION_SPECS.filter((spec) => spec.group === group).map((spec) => spec.name);
}
