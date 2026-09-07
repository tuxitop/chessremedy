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

/**
 * Per-position engine overrides carried by a game-analysis run (Game-analysis
 * settings, Q2 = Option A). Only values the user explicitly overrides are
 * present; the profile's own depth/hash/MultiPV stay the baseline (they are
 * part of the engine identity). `scope` does not exist (Q1 dropped — analysis
 * always classifies both sides).
 */
export interface GameAnalysisConfig {
  readonly maxDepth?: number;
  /** Per-position search time in milliseconds. */
  readonly movetimeMs?: number;
  /**
   * Optional engine thread-count override for a run. Absent = the engine's
   * capability-derived default (ADR-012: `min(2, hardwareConcurrency)` under
   * cross-origin isolation). Only meaningful on the multi-threaded build.
   */
  readonly threads?: number;
}

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
  /**
   * Depth/search-time overrides of the Game-analysis settings under which this
   * run was created. Absent when the run used the profile defaults.
   */
  readonly config?: GameAnalysisConfig;
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
 * Deterministic, order-stable fingerprint of a run's Game-analysis overrides.
 * Only user-specified overrides are encoded (profile depth is already part of
 * the engine identity). `undefined` when no override is in effect, so a plain
 * run keeps the historical id (stored-key/cache compatibility, ADR-018).
 */
export function gameAnalysisConfigFingerprint(
  config?: GameAnalysisConfig | null,
): string | undefined {
  if (!config) {
    return undefined;
  }
  const parts: string[] = [];
  if (config.maxDepth !== undefined) {
    parts.push(`d${config.maxDepth}`);
  }
  if (config.movetimeMs !== undefined) {
    parts.push(`t${config.movetimeMs}`);
  }
  if (config.threads !== undefined) {
    parts.push(`n${config.threads}`);
  }
  return parts.length > 0 ? parts.join(',') : undefined;
}

function hasOverrides(config?: GameAnalysisConfig | null): config is GameAnalysisConfig {
  return (
    config !== undefined &&
    config !== null &&
    (config.maxDepth !== undefined ||
      config.movetimeMs !== undefined ||
      config.threads !== undefined)
  );
}

/**
 * Deterministic id for an analysis of `gameId` under a configuration. Two
 * analyses of the same game that use materially different configurations are
 * distinguishable (Feature 008 §4, ADR-020). Includes the pipeline/classification/
 * phase versions, the engine identity (name/version/build/profile) and a
 * fingerprint of the Game-analysis depth/search-time/threads overrides (when
 * present).
 */
export function analysisJobId(
  gameId: string,
  engine: EngineMetadata,
  versions?: {
    readonly analysisVersion?: number;
    readonly classificationVersion?: number;
    readonly gamePhaseVersion?: number;
  },
  config?: GameAnalysisConfig | null,
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
  const configPart = hasOverrides(config) ? `|cfg:${gameAnalysisConfigFingerprint(config)}` : '';
  return `${gameId}|a${analysisVersion}|c${classificationVersion}|p${gamePhaseVersion}|${enginePart}${configPart}`;
}

export function createAnalysisJob(
  gameId: string,
  engine: EngineMetadata,
  totalPositions: number,
  nowMs: number,
  config?: GameAnalysisConfig | null,
): AnalysisJob {
  const job: AnalysisJob = {
    id: analysisJobId(gameId, engine, undefined, config),
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
  return hasOverrides(config) ? { ...job, config } : job;
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
  config?: GameAnalysisConfig | null,
): AnalysisJob {
  if (stored) {
    if (stored.state === 'queued' || stored.state === 'inProgress') {
      return stored;
    }
    if (stored.state === 'completed') {
      return stored;
    }
    const fresh = createAnalysisJob(gameId, engine, totalPositions, nowMs, config);
    const out: AnalysisJob = {
      ...fresh,
      id: stored.id,
      createdAt: stored.createdAt,
      engine: stored.engine,
    };
    return stored.config !== undefined ? { ...out, config: stored.config } : out;
  }
  return createAnalysisJob(gameId, engine, totalPositions, nowMs, config);
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
    ...(job.config !== undefined ? { config: job.config } : {}),
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
