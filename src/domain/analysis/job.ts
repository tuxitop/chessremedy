/**
 * Game-analysis job state machine (Feature 008).
 *
 * A persistent, resumable, per-game analysis job keyed by a deterministic
 * analysis identity (`analysisJobId`). Pure transitions produce a new
 * `AnalysisJob` — this module has no React, database, engine or Worker
 * dependencies — so the orchestration service can unit-test resume/failure
 * semantics in Node.
 *
 * State names follow `specs/domain/analysis-model.md`:
 * `queued | inProgress | completed | cancelled | failed`.
 */

import { ANALYSIS_VERSION, type AnalysisJobState, type EngineMetadata } from '@/domain/chess';
import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import { GAME_PHASE_VERSION } from '@/domain/chess/gamePhase';

export type { AnalysisJobState };

export const DEFAULT_ANALYSIS_PROFILE = 'normal';

export interface AnalysisJob {
  /** Deterministic analysis-identity id; also the `analysisId` on records. */
  readonly id: string;
  readonly gameId: string;
  /** Engine identity (name/version/build/profile) that produced this job. */
  readonly engine: EngineMetadata;
  readonly analysisVersion: number;
  readonly classificationVersion: number;
  readonly gamePhaseVersion: number;
  readonly state: AnalysisJobState;
  /** Number of engine positions the job must analyse. */
  readonly totalPositions: number;
  /** Positions analysed so far (drives game-level progress). */
  readonly completedPositions: number;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
}

export interface AnalysisJobPatch {
  readonly state?: AnalysisJobState;
  readonly totalPositions?: number;
  readonly completedPositions?: number;
  readonly lastError?: string | null;
  readonly startedAt?: number;
  readonly completedAt?: number | null;
}

/**
 * Deterministic id for an analysis of `gameId` under a configuration. Two
 * analyses of the same game that use materially different configurations are
 * distinguishable (Feature 008 §4, ADR-020). Includes the pipeline/classification/
 * phase versions and the engine identity (name/version/build/profile).
 */
export function analysisJobId(
  gameId: string,
  engine: EngineMetadata,
  versions?: {
    readonly analysisVersion?: number;
    readonly classificationVersion?: number;
    readonly gamePhaseVersion?: number;
  },
): string {
  const analysisVersion = versions?.analysisVersion ?? ANALYSIS_VERSION;
  const classificationVersion = versions?.classificationVersion ?? CLASSIFICATION_VERSION;
  const gamePhaseVersion = versions?.gamePhaseVersion ?? GAME_PHASE_VERSION;
  const enginePart = [
    engine.engineName,
    engine.engineVersion,
    engine.engineBuild,
    engine.profile,
  ].join('@');
  return `${gameId}|a${analysisVersion}|c${classificationVersion}|p${gamePhaseVersion}|${enginePart}`;
}

export function createAnalysisJob(
  gameId: string,
  engine: EngineMetadata,
  totalPositions: number,
  nowMs: number,
): AnalysisJob {
  return {
    id: analysisJobId(gameId, engine),
    gameId,
    engine,
    analysisVersion: ANALYSIS_VERSION,
    classificationVersion: CLASSIFICATION_VERSION,
    gamePhaseVersion: GAME_PHASE_VERSION,
    state: 'queued',
    totalPositions,
    completedPositions: 0,
    lastError: null,
    createdAt: nowMs,
    updatedAt: nowMs,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Prepare a job for a (re)run. A stored `queued`/`inProgress` job is resumed
 * as-is (interrupted work continues from its persisted position); a stored
 * terminal job (`cancelled`/`failed`) restarts from scratch under the same
 * deterministic id — never creating a duplicate active job for the same game
 * and analysis identity. A `completed` job is returned unchanged; callers
 * treat it as "already done".
 */
export function jobForRun(
  stored: AnalysisJob | undefined,
  gameId: string,
  engine: EngineMetadata,
  totalPositions: number,
  nowMs: number,
): AnalysisJob {
  if (stored) {
    if (stored.state === 'queued' || stored.state === 'inProgress') {
      return stored;
    }
    if (stored.state === 'completed') {
      return stored;
    }
    const fresh = createAnalysisJob(gameId, engine, totalPositions, nowMs);
    return {
      ...fresh,
      id: stored.id,
      createdAt: stored.createdAt,
      engine: stored.engine,
    };
  }
  return createAnalysisJob(gameId, engine, totalPositions, nowMs);
}

/** Pure transition applying a small patch. */
export function patchJob(job: AnalysisJob, patch: AnalysisJobPatch, nowMs: number): AnalysisJob {
  return {
    id: job.id,
    gameId: job.gameId,
    engine: job.engine,
    analysisVersion: job.analysisVersion,
    classificationVersion: job.classificationVersion,
    gamePhaseVersion: job.gamePhaseVersion,
    state: patch.state ?? job.state,
    totalPositions: patch.totalPositions ?? job.totalPositions,
    completedPositions: patch.completedPositions ?? job.completedPositions,
    lastError: 'lastError' in patch ? (patch.lastError ?? null) : job.lastError,
    createdAt: job.createdAt,
    updatedAt: nowMs,
    startedAt: 'startedAt' in patch ? (patch.startedAt ?? null) : job.startedAt,
    completedAt: 'completedAt' in patch ? (patch.completedAt ?? null) : job.completedAt,
  };
}

export function markInProgress(job: AnalysisJob, nowMs: number): AnalysisJob {
  return patchJob(job, { state: 'inProgress', startedAt: job.startedAt ?? nowMs }, nowMs);
}

export function markProgress(
  job: AnalysisJob,
  completedPositions: number,
  nowMs: number,
): AnalysisJob {
  return patchJob(job, { completedPositions }, nowMs);
}

export function markFailed(job: AnalysisJob, reason: string, nowMs: number): AnalysisJob {
  return patchJob(job, { state: 'failed', lastError: reason, completedAt: nowMs }, nowMs);
}

export function markCancelled(job: AnalysisJob, nowMs: number): AnalysisJob {
  return patchJob(job, { state: 'cancelled', completedAt: nowMs }, nowMs);
}

export function markCompleted(job: AnalysisJob, nowMs: number): AnalysisJob {
  return patchJob(job, { state: 'completed', completedAt: nowMs }, nowMs);
}
