/**
 * Library/review analysis status derivation (Feature 008 §16).
 *
 * A game's analysis status is derived from its persistent jobs only (never
 * from transient React state). Statuses follow the Feature-008 spec:
 * `unanalyzed | queued | inProgress | completed | cancelled | failed`.
 */

import { ANALYSIS_VERSION } from '@/domain/chess';
import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import { GAME_PHASE_VERSION } from '@/domain/chess/gamePhase';
import type { AnalysisJob } from './job';

export const GAME_ANALYSIS_STATUSES = [
  'unanalyzed',
  'queued',
  'inProgress',
  'completed',
  'cancelled',
  'failed',
] as const;
export type GameAnalysisStatus = (typeof GAME_ANALYSIS_STATUSES)[number];

/**
 * Status of one game given every job ever created for it.
 *
 * Precedence: an active run (`queued`/`inProgress`) wins; otherwise a
 * completed analysis (any identity) makes the game reviewable; a `failed`
 * run is surfaced so it can be retried; a `cancelled` run is shown only when
 * nothing else ever completed.
 */
export function analysisStatusOf(jobs: readonly AnalysisJob[]): GameAnalysisStatus {
  for (const state of ['inProgress', 'queued'] as const) {
    if (jobs.some((job) => job.state === state)) {
      return state;
    }
  }
  if (jobs.some((job) => job.state === 'completed')) {
    return 'completed';
  }
  if (jobs.some((job) => job.state === 'failed')) {
    return 'failed';
  }
  if (jobs.some((job) => job.state === 'cancelled')) {
    return 'cancelled';
  }
  return 'unanalyzed';
}

/**
 * The completed job to display for a game: the most recently completed run
 * (any analysis identity). Returns `undefined` when nothing ever completed.
 */
export function latestCompletedJob(jobs: readonly AnalysisJob[]): AnalysisJob | undefined {
  return jobs
    .filter((job) => job.state === 'completed')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/**
 * True when a completed analysis was produced by a configuration that is no
 * longer current (ARCHITECTURE.md §9 versioning): a stale pipeline,
 * classification or game-phase version. Engine upgrades (ADR-020) keep their
 * analysis valid, so an engine mismatch is deliberately not "obsolete".
 */
export function isAnalysisObsolete(job: AnalysisJob): boolean {
  return (
    job.analysisVersion < ANALYSIS_VERSION ||
    job.classificationVersion < CLASSIFICATION_VERSION ||
    job.gamePhaseVersion < GAME_PHASE_VERSION
  );
}
