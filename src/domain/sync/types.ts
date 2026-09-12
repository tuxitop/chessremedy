/**
 * Feature 016 — synchronization vocabulary (domain, pure).
 *
 * The provider-independent shapes shared by the sync engine, the Dropbox
 * adapter and the local export/import path. This module imports **types only**
 * (from the existing domain and persistence row models) and carries no React,
 * Dexie, Worker, `fetch` or engine runtime dependency — `import type` is fully
 * erased by `verbatimModuleSyntax`.
 *
 * Source of truth: `specs/features/016-synchronization.md`, ADR-016 (file
 * format) and ADR-017 (conflict resolution).
 */

import type { GameRow } from '@/infrastructure/db/games-repository';
import type { SettingRow } from '@/infrastructure/db/database';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import type { PuzzleCandidateRow } from '@/infrastructure/db/candidates-repository';
import type { AnalysisJob } from '@/domain/analysis';
import type { MoveAnalysis } from '@/domain/chess';
import type { PuzzleRow } from '@/domain/puzzle';
import type { PuzzleAttemptRow, TacticalTrainingSetRow, TrainingCycleRow } from '@/domain/training';

/**
 * Version of the ADR-016 sync payload. Reading clients reject a payload with a
 * version they do not understand (ADR-016 Migration); a transform must be
 * registered in `ENVELOPE_MIGRATIONS` before a version 2 is ever published.
 */
export const SYNC_PAYLOAD_VERSION = 1;

/**
 * Stable per-device identifier. Generated once and persisted in the
 * non-synced `syncState` table; used only as the ADR-017 tie-break when two
 * records share an `updatedAt`.
 */
export type DeviceId = string;

/**
 * Names of the leaf collections carried by the envelope (ADR-016 §collections).
 * `tombstones` is the additive deletion collection (G1) and is **not** a leaf
 * of the collection registry — it merges by its own rule.
 */
export type SyncCollectionName =
  | 'games'
  | 'analyses'
  | 'analysisJobs'
  | 'analysisSummaries'
  | 'puzzleCandidates'
  | 'puzzles'
  | 'trainingSets'
  | 'trainingCycles'
  | 'puzzleAttempts'
  | 'settings';

/** Envelope grouping of the leaf collections (ADR-016 nested shape). */
export type SyncCollectionGroup =
  | 'games'
  | 'analysis'
  | 'puzzles'
  | 'trainingSets'
  | 'trainingCycles'
  | 'puzzleAttempts'
  | 'settings';

/** The two user-deletable top-level entities that propagate as tombstones. */
export type TombstoneKind = 'game' | 'trainingSet';

/**
 * A deletion record (ADR-016, ADR-017). `id` is the deterministic
 * `tombstoneId(kind, recordId)`. Derived rows (analyses, candidates, puzzles,
 * attempts, cycles) need no tombstone: the game/set ownership cascade removes
 * them on every device (spec "Deletion & derived state").
 */
export interface SyncTombstone {
  readonly id: string;
  readonly kind: TombstoneKind;
  readonly recordId: string;
  /** Unix epoch millis when the deletion happened. */
  readonly deletedAt: number;
  readonly deviceId: DeviceId;
}

/**
 * Provider-independent sync status surfaced in the header and Settings
 * (`specs/features/016-synchronization.md`). Persisted in `syncState` so the
 * last known status survives a reload.
 */
export type SyncStatus =
  'disabled' | 'disconnected' | 'idle' | 'syncing' | 'offline' | 'error' | 'conflict';

/**
 * Remote file metadata returned by a `SyncProvider` (ADR-015/ADR-017).
 * `rev`/`contentHash` never leak past the sync engine into the domain.
 */
export interface RemoteFileMetadata {
  /** Dropbox file revision used for optimistic concurrency. */
  readonly rev: string;
  /** Dropbox `content_hash` of the stored bytes. */
  readonly contentHash: string;
  /** Size in bytes. */
  readonly size: number;
  /** Server modification time, ISO-8601. */
  readonly serverModified: string;
}

/** The nested `analysis` group of the version-1 envelope. */
export interface SyncAnalysisCollectionsV1 {
  readonly analyses: MoveAnalysis[];
  readonly analysisJobs: AnalysisJob[];
  readonly analysisSummaries: AnalysisSummaryRow[];
  readonly puzzleCandidates: PuzzleCandidateRow[];
}

/**
 * The version-1 envelope collections (ADR-016). Records keep their existing
 * Dexie shape; the envelope adds metadata only.
 */
export interface SyncEnvelopeCollectionsV1 {
  readonly games: GameRow[];
  readonly analysis: SyncAnalysisCollectionsV1;
  readonly puzzles: PuzzleRow[];
  readonly trainingSets: TacticalTrainingSetRow[];
  readonly trainingCycles: TrainingCycleRow[];
  readonly puzzleAttempts: PuzzleAttemptRow[];
  readonly settings: SettingRow[];
  /** Additive deletion collection (G1). */
  readonly tombstones: SyncTombstone[];
}

/**
 * The ADR-016 top-level sync envelope. `exportedAt` is an ISO-8601 timestamp;
 * `deviceId` is the producing device.
 */
export interface SyncEnvelopeV1 {
  readonly version: typeof SYNC_PAYLOAD_VERSION;
  readonly exportedAt: string;
  readonly deviceId: DeviceId;
  readonly collections: SyncEnvelopeCollectionsV1;
}
