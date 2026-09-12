/**
 * Feature 016 — Dexie snapshot gateway (infrastructure).
 *
 * The single seam between the pure sync domain and local persistence: it reads
 * every leaf collection of the ADR-016 envelope from Dexie and applies an
 * incoming envelope back through the ADR-017 record merge. This is deliberately
 * the **only** sync module that imports the database; the domain, provider
 * adapters and engine never touch Dexie directly.
 *
 * Guarantees:
 *
 * - **Derived time-control fields are never trusted.** Every merged `games`
 *   row is recomputed from its verbatim `timeControl` + `source` via
 *   `parseTimeControl` / `timeControlProfileForSource` before it is written
 *   (ADR-013), so a stale remote category cannot be reintroduced.
 * - **Deletion wins the round.** Record upserts happen first; the merged
 *   tombstones are then applied through the existing game/set ownership
 *   cascades, so derived rows are removed everywhere. The FEN-keyed engine
 *   cache is deliberately never read or purged (ADR-018).
 * - **Non-synced state stays out.** `positionAnalysisCache`, `syncState` and
 *   `syncBackups` are never part of the envelope (only the stable `deviceId`
 *   bookkeeping value is read, and it never becomes a collection).
 */

import type { Table } from 'dexie';
import {
  SYNC_COLLECTION_BY_NAME,
  SYNC_PAYLOAD_VERSION,
  mergeCollection,
  mergeSettings,
  mergeTombstones,
  selectSyncedSettings,
  type DeviceId,
  type SyncCollectionSpec,
  type SyncEnvelopeCollectionsV1,
  type SyncEnvelopeV1,
  type SyncTombstone,
} from '@/domain/sync';
import { parseTimeControl, timeControlProfileForSource } from '@/domain/chess/timeControl';
import { db, type ChessRemedyDatabase } from '@/infrastructure/db/database';
import { DexieGamesRepository, type GameRow } from '@/infrastructure/db/games-repository';
import { DexieTrainingSetsRepository } from '@/infrastructure/db/training-sets-repository';
import { DexieSyncStateRepository } from '@/infrastructure/db/sync-state-repository';

/** Options for `applyEnvelope`. */
export interface ApplyEnvelopeOptions {
  /** Producing device id for the ADR-017 tie-break; defaults to the envelope's. */
  readonly remoteDeviceId?: DeviceId;
}

/** Read/apply the leaf collections of the sync envelope from Dexie. */
export interface SyncCollectionsGateway {
  /** Build the canonical local envelope (leaf collections + tombstones). */
  exportLocal(): Promise<SyncEnvelopeV1>;
  /** Merge `envelope` into local storage, recomputing derived fields. */
  applyEnvelope(envelope: SyncEnvelopeV1, options?: ApplyEnvelopeOptions): Promise<void>;
}

/** The Dexie-backed `SyncCollectionsGateway`. */
export class DexieSyncCollectionsGateway implements SyncCollectionsGateway {
  private readonly database: ChessRemedyDatabase;
  private readonly games: DexieGamesRepository;
  private readonly trainingSets: DexieTrainingSetsRepository;
  private readonly syncState: DexieSyncStateRepository;

  constructor(database: ChessRemedyDatabase = db) {
    this.database = database;
    this.games = new DexieGamesRepository(database);
    this.trainingSets = new DexieTrainingSetsRepository(database);
    this.syncState = new DexieSyncStateRepository(database);
  }

  async exportLocal(): Promise<SyncEnvelopeV1> {
    const [deviceId, collections] = await Promise.all([
      this.syncState.getOrCreateDeviceId(),
      this.readLocalCollections(),
    ]);
    return {
      version: SYNC_PAYLOAD_VERSION,
      exportedAt: new Date().toISOString(),
      deviceId,
      collections,
    };
  }

  async applyEnvelope(envelope: SyncEnvelopeV1, options: ApplyEnvelopeOptions = {}): Promise<void> {
    const localDeviceId = await this.syncState.getOrCreateDeviceId();
    const remoteDeviceId = options.remoteDeviceId ?? envelope.deviceId;
    const local = await this.readLocalCollections();

    const mergedTombstones = mergeTombstones(
      local.tombstones,
      envelope.collections.tombstones,
      localDeviceId,
      remoteDeviceId,
    );

    const discarded = new Set<string>();
    const merge = <T>(
      localRecords: readonly T[],
      remoteRecords: readonly T[],
      spec: SyncCollectionSpec,
    ): T[] => {
      const result = mergeCollection<T>(
        localRecords,
        remoteRecords,
        spec,
        mergedTombstones,
        localDeviceId,
        remoteDeviceId,
      );
      for (const id of result.discardedTombstoneIds) {
        discarded.add(id);
      }
      return [...result.records];
    };

    // Games are the only collection whose persisted derived fields are
    // recomputed; a remote row is never trusted for `timeControlModel` /
    // `normalizedTimeControl` (ADR-013).
    const games = merge(local.games, envelope.collections.games, SYNC_COLLECTION_BY_NAME.games).map(
      recomputeGameTimeControl,
    );
    const analyses = merge(
      local.analysis.analyses,
      envelope.collections.analysis.analyses,
      SYNC_COLLECTION_BY_NAME.analyses,
    );
    const analysisJobs = merge(
      local.analysis.analysisJobs,
      envelope.collections.analysis.analysisJobs,
      SYNC_COLLECTION_BY_NAME.analysisJobs,
    );
    const analysisSummaries = merge(
      local.analysis.analysisSummaries,
      envelope.collections.analysis.analysisSummaries,
      SYNC_COLLECTION_BY_NAME.analysisSummaries,
    );
    const puzzleCandidates = merge(
      local.analysis.puzzleCandidates,
      envelope.collections.analysis.puzzleCandidates,
      SYNC_COLLECTION_BY_NAME.puzzleCandidates,
    );
    const puzzles = merge(
      local.puzzles,
      envelope.collections.puzzles,
      SYNC_COLLECTION_BY_NAME.puzzles,
    );
    const trainingSets = merge(
      local.trainingSets,
      envelope.collections.trainingSets,
      SYNC_COLLECTION_BY_NAME.trainingSets,
    );
    const trainingCycles = merge(
      local.trainingCycles,
      envelope.collections.trainingCycles,
      SYNC_COLLECTION_BY_NAME.trainingCycles,
    );
    const puzzleAttempts = merge(
      local.puzzleAttempts,
      envelope.collections.puzzleAttempts,
      SYNC_COLLECTION_BY_NAME.puzzleAttempts,
    );
    const settings = mergeSettings(
      local.settings,
      envelope.collections.settings,
      localDeviceId,
      remoteDeviceId,
    ).records;

    // A tombstone that a strictly newer record recreated must not survive.
    const activeTombstones = mergedTombstones.filter((tombstone) => !discarded.has(tombstone.id));

    // The cascade targets are the non-discarded tombstones whose top-level row
    // still exists locally; a deletion for an absent row needs no cascade.
    const gameIds = await existingIds(this.database.games, tombstonesOf(activeTombstones, 'game'));
    const setIds = await existingIds(
      this.database.trainingSets,
      tombstonesOf(activeTombstones, 'trainingSet'),
    );

    await this.database.transaction(
      'rw',
      [
        this.database.games,
        this.database.analyses,
        this.database.analysisJobs,
        this.database.analysisSummaries,
        this.database.puzzleCandidates,
        this.database.puzzles,
        this.database.trainingSets,
        this.database.trainingCycles,
        this.database.puzzleAttempts,
        this.database.settings,
        this.database.syncTombstones,
      ],
      async () => {
        await putAll(this.database.games, games);
        await putAll(this.database.analyses, analyses);
        await putAll(this.database.analysisJobs, analysisJobs);
        await putAll(this.database.analysisSummaries, analysisSummaries);
        await putAll(this.database.puzzleCandidates, puzzleCandidates);
        await putAll(this.database.puzzles, puzzles);
        await putAll(this.database.trainingSets, trainingSets);
        await putAll(this.database.trainingCycles, trainingCycles);
        await putAll(this.database.puzzleAttempts, puzzleAttempts);
        await putAll(this.database.settings, settings);
        await putAll(this.database.syncTombstones, activeTombstones);
        if (discarded.size > 0) {
          await this.database.syncTombstones.bulkDelete([...discarded]);
        }
      },
    );

    // Deletion wins the round: run the ownership cascades after the upserts.
    // They write their own (fresher) tombstone in the same transaction.
    if (gameIds.length > 0) {
      await this.games.deleteGames(gameIds);
    }
    for (const setId of setIds) {
      await this.trainingSets.delete(setId);
    }
  }

  /** Read every leaf collection (settings through the allowlist) + tombstones. */
  private async readLocalCollections(): Promise<SyncEnvelopeCollectionsV1> {
    const [
      games,
      analyses,
      analysisJobs,
      analysisSummaries,
      puzzleCandidates,
      puzzles,
      trainingSets,
      trainingCycles,
      puzzleAttempts,
      settings,
      tombstones,
    ] = await Promise.all([
      this.database.games.toArray(),
      this.database.analyses.toArray(),
      this.database.analysisJobs.toArray(),
      this.database.analysisSummaries.toArray(),
      this.database.puzzleCandidates.toArray(),
      this.database.puzzles.toArray(),
      this.database.trainingSets.toArray(),
      this.database.trainingCycles.toArray(),
      this.database.puzzleAttempts.toArray(),
      this.database.settings.toArray(),
      this.database.syncTombstones.toArray(),
    ]);
    return {
      games,
      analysis: { analyses, analysisJobs, analysisSummaries, puzzleCandidates },
      puzzles,
      trainingSets,
      trainingCycles,
      puzzleAttempts,
      settings: [...selectSyncedSettings(settings)],
      tombstones,
    };
  }
}

/** Recompute the canonical time-control model/category for a game row. */
function recomputeGameTimeControl(row: GameRow): GameRow {
  const model = parseTimeControl(row.timeControl, timeControlProfileForSource(row.source));
  return { ...row, timeControlModel: model, normalizedTimeControl: model.category };
}

/** The `recordId`s of the non-discarded tombstones of one kind. */
function tombstonesOf(tombstones: readonly SyncTombstone[], kind: SyncTombstone['kind']): string[] {
  const ids: string[] = [];
  for (const tombstone of tombstones) {
    if (tombstone.kind === kind) {
      ids.push(tombstone.recordId);
    }
  }
  return ids;
}

/** The subset of `ids` that still has a row in `table` (primary-key lookup). */
async function existingIds<T extends { readonly id: string }>(
  table: Table<T, string>,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await table.bulkGet([...ids]);
  const present: string[] = [];
  for (const row of rows) {
    if (row !== undefined) {
      present.push(row.id);
    }
  }
  return present;
}

/** The minimal Dexie table surface `putAll` needs, key-agnostic. */
interface BulkPutTarget<T> {
  bulkPut(items: readonly T[]): Promise<unknown>;
}

/** `bulkPut` that tolerates an empty batch. */
async function putAll<T>(table: BulkPutTarget<T>, rows: readonly T[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await table.bulkPut([...rows]);
}

export const syncCollectionsGateway: SyncCollectionsGateway = new DexieSyncCollectionsGateway();
