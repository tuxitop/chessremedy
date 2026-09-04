/**
 * Import job state machine (Feature 007).
 *
 * A persistent, resumable batch import job per account
 * (`{provider}:{username}`). Pure transitions produce a new `ImportJob` —
 * this module has no React, database or network dependencies — so the
 * orchestration service can unit-test resume/failure semantics in Node.
 *
 * The cursor is an opaque, serializable, provider-specific resume point:
 * Chess.com stores the monthly-archive walk position, Lichess the `since`
 * timestamp. Filter equality (stored vs next run) decides incremental
 * resume versus a full re-sweep.
 */

import { filtersEqual, type ImportFilters } from './filters';
import type { ImportProvider } from './providerGame';

export type ImportJobStatus = 'running' | 'paused' | 'failed' | 'completed';

export interface ImportCounters {
  /** Records fetched from the provider. */
  readonly seen: number;
  readonly inserted: number;
  readonly updated: number;
  readonly duplicates: number;
  /** Games that could not be imported (parse/identity/color errors). */
  readonly failed: number;
  /** Unsupported games (non-standard variants), from adapter pages. */
  readonly skipped: number;
  /** Games excluded by the user's time-frame / time-control selection. */
  readonly filtered: number;
}

export interface ImportErrorSample {
  readonly externalId: string | null;
  readonly reason: string;
}

/** Deterministic page position for progress (Chess.com monthly archives). */
export interface ImportPosition {
  readonly current: number;
  readonly total: number;
}

export interface ImportJob {
  /** `${provider}:${username.toLowerCase()}`. */
  readonly id: string;
  readonly provider: ImportProvider;
  /** Username exactly as the user typed it. */
  readonly username: string;
  /** Filters of the current run (drives incremental vs re-sweep). */
  readonly filters: ImportFilters;
  readonly status: ImportJobStatus;
  readonly cursor: unknown;
  readonly counters: ImportCounters;
  readonly errorSamples: readonly ImportErrorSample[];
  readonly position: ImportPosition | null;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
}

export const MAX_ERROR_SAMPLES = 20;

export const EMPTY_COUNTERS: ImportCounters = {
  seen: 0,
  inserted: 0,
  updated: 0,
  duplicates: 0,
  failed: 0,
  skipped: 0,
  filtered: 0,
};

export interface ImportJobPatch {
  readonly status?: ImportJobStatus;
  readonly cursor?: unknown;
  readonly position?: ImportPosition | null;
  readonly lastError?: string | null;
  readonly addCounters?: Partial<ImportCounters>;
  readonly appendErrors?: readonly ImportErrorSample[];
  readonly startedAt?: number;
  readonly completedAt?: number | null;
}

export function importJobId(provider: ImportProvider, username: string): string {
  return `${provider}:${username.trim().toLowerCase()}`;
}

export function createImportJob(
  provider: ImportProvider,
  username: string,
  filters: ImportFilters,
  nowMs: number,
): ImportJob {
  return {
    id: importJobId(provider, username),
    provider,
    username: username.trim(),
    filters,
    status: 'running',
    cursor: null,
    counters: EMPTY_COUNTERS,
    errorSamples: [],
    position: null,
    lastError: null,
    createdAt: nowMs,
    updatedAt: nowMs,
    startedAt: nowMs,
    completedAt: null,
  };
}

/**
 * Prepare the job for a new run. When the request filters differ from the
 * stored job's, this is a **re-sweep**: the cursor and counters reset and the
 * archive is re-scanned under the new selection (duplicates are absorbed by
 * Feature-004 detection). Identical filters resume from the stored cursor.
 */
export function jobForRun(
  stored: ImportJob | undefined,
  provider: ImportProvider,
  username: string,
  filters: ImportFilters,
  nowMs: number,
): ImportJob {
  if (stored && filtersEqual(stored.filters, filters)) {
    return patchJob(
      stored,
      { status: 'running', lastError: null, position: null, startedAt: nowMs },
      nowMs,
    );
  }
  return createImportJob(provider, username, filters, nowMs);
}

/** Pure job transition applying a small patch. */
export function patchJob(job: ImportJob, patch: ImportJobPatch, nowMs: number): ImportJob {
  const counters = patch.addCounters ? addCounters(job.counters, patch.addCounters) : job.counters;
  const errorSamples = patch.appendErrors
    ? mergeErrorSamples(job.errorSamples, patch.appendErrors)
    : job.errorSamples;
  return {
    id: job.id,
    provider: job.provider,
    username: job.username,
    filters: job.filters,
    status: patch.status ?? job.status,
    cursor: 'cursor' in patch ? patch.cursor : job.cursor,
    counters,
    errorSamples,
    position: 'position' in patch ? (patch.position ?? null) : job.position,
    lastError: 'lastError' in patch ? (patch.lastError ?? null) : job.lastError,
    createdAt: job.createdAt,
    updatedAt: nowMs,
    startedAt: 'startedAt' in patch ? (patch.startedAt ?? job.startedAt) : job.startedAt,
    completedAt: 'completedAt' in patch ? (patch.completedAt ?? job.completedAt) : job.completedAt,
  };
}

export function markPaused(job: ImportJob, nowMs: number): ImportJob {
  return patchJob(job, { status: 'paused' }, nowMs);
}

export function markFailed(job: ImportJob, reason: string, nowMs: number): ImportJob {
  return patchJob(job, { status: 'failed', lastError: reason, completedAt: nowMs }, nowMs);
}

export function markCompleted(job: ImportJob, nowMs: number): ImportJob {
  return patchJob(job, { status: 'completed', completedAt: nowMs }, nowMs);
}

function addCounters(counters: ImportCounters, delta: Partial<ImportCounters>): ImportCounters {
  return {
    seen: counters.seen + (delta.seen ?? 0),
    inserted: counters.inserted + (delta.inserted ?? 0),
    updated: counters.updated + (delta.updated ?? 0),
    duplicates: counters.duplicates + (delta.duplicates ?? 0),
    failed: counters.failed + (delta.failed ?? 0),
    skipped: counters.skipped + (delta.skipped ?? 0),
    filtered: counters.filtered + (delta.filtered ?? 0),
  };
}

function mergeErrorSamples(
  existing: readonly ImportErrorSample[],
  incoming: readonly ImportErrorSample[],
): readonly ImportErrorSample[] {
  const merged = [...existing, ...incoming];
  return merged.slice(-MAX_ERROR_SAMPLES);
}
