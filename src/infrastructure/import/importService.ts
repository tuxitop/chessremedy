/**
 * Import orchestration service (Feature 007).
 *
 * Coordinates one resumable import job per account: validates the account
 * through the provider adapter, walks provider pages, maps each record onto a
 * domain `Game`, filters by the user's time-frame / time-control selection,
 * persists in batches through `gamesRepository.saveGames` (Feature-004
 * duplicate detection is reused verbatim) and persists the job after every
 * page. Runs on the UI thread in awaited page steps (ARCHITECTURE §10
 * allows incremental/batched/resumable jobs without a Worker). Cancellation
 * pauses the job; the engine is never reachable from this module.
 */

import type { GamesRepository } from '@/infrastructure/db/games-repository';
import type { ImportJobsRepository } from '@/infrastructure/db/import-jobs-repository';
import type { ProviderAdapter, ProviderPageResult } from '@/infrastructure/providers/types';
import type { ImportFilters, TimeWindow } from '@/domain/import/filters';
import {
  filtersEqual,
  playedAtInWindow,
  resolveTimeFrame,
  timeControlsMatch,
  validateImportFilters,
} from '@/domain/import/filters';
import type { ImportProvider } from '@/domain/import/providerGame';
import { providerGameToGame } from '@/domain/import/providerGame';
import type { ImportJob } from '@/domain/import/job';
import {
  importJobId,
  jobForRun,
  markCompleted,
  markFailed,
  markPaused,
  patchJob,
} from '@/domain/import/job';
import { ProviderHttpError } from '@/infrastructure/providers/transport';
import type { Game } from '@/domain/chess/game';

export const IMPORT_BATCH_SIZE = 25;

export interface ImportServiceOptions {
  readonly games: GamesRepository;
  readonly jobs: ImportJobsRepository;
  readonly adapters: Readonly<Record<ImportProvider, ProviderAdapter>>;
  readonly now?: () => number;
}

export interface ImportRunOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (job: ImportJob) => void;
}

export interface StartImportRequest {
  readonly provider: ImportProvider;
  readonly username: string;
  readonly filters: ImportFilters;
}

export class ImportServiceError extends Error {
  readonly code: 'empty-username' | 'invalid-filters' | 'already-running';

  constructor(code: 'empty-username' | 'invalid-filters' | 'already-running', message: string) {
    super(message);
    this.name = 'ImportServiceError';
    this.code = code;
  }
}

function isImportProvider(value: unknown): value is ImportProvider {
  return value === 'chesscom' || value === 'lichess';
}

export class ImportService {
  private readonly games: GamesRepository;
  private readonly jobs: ImportJobsRepository;
  private readonly adapters: Readonly<Record<ImportProvider, ProviderAdapter>>;
  private readonly now: () => number;
  private readonly active = new Set<string>();

  constructor(options: ImportServiceOptions) {
    this.games = options.games;
    this.jobs = options.jobs;
    this.adapters = options.adapters;
    this.now = options.now ?? (() => Date.now());
  }

  listJobs(): Promise<readonly ImportJob[]> {
    return this.jobs.listJobs();
  }

  getJob(provider: ImportProvider, username: string): Promise<ImportJob | undefined> {
    return this.jobs.getJob(importJobId(provider, username));
  }

  async removeJob(provider: ImportProvider, username: string): Promise<void> {
    await this.jobs.deleteJob(importJobId(provider, username));
  }

  /** Start or resume an import for an account under the given filters. */
  async start(request: StartImportRequest, run?: ImportRunOptions): Promise<ImportJob> {
    if (!isImportProvider(request.provider)) {
      throw new ImportServiceError('invalid-filters', 'Unsupported import provider.');
    }
    const username = request.username.trim();
    if (username === '') {
      throw new ImportServiceError('empty-username', 'Enter a Chess.com or Lichess username.');
    }
    const filters = request.filters;
    const validationError = validateImportFilters(filters);
    if (validationError !== null) {
      throw new ImportServiceError('invalid-filters', `Invalid import filters: ${validationError}`);
    }

    const id = importJobId(request.provider, username);
    if (this.active.has(id)) {
      throw new ImportServiceError(
        'already-running',
        'An import for this account is already running in this session.',
      );
    }

    const stored = await this.jobs.getJob(id);
    const job = jobForRun(stored, request.provider, username, filters, this.now());
    await this.persist(job, run);

    try {
      await this.adapters[request.provider].validateUsername(
        username,
        run?.signal ?? neverSignal(),
      );
    } catch (err) {
      if (isAbort(run?.signal)) {
        return this.finishRun(markPaused(job, this.now()), run);
      }
      const failed = markFailed(job, humanizeError(err), this.now());
      await this.persist(failed, run);
      return failed;
    }

    if (isAbort(run?.signal)) {
      return this.finishRun(markPaused(job, this.now()), run);
    }

    return this.runJob(job, run);
  }

  /** Resume a paused/failed job from its stored filters and cursor. */
  async resume(
    provider: ImportProvider,
    username: string,
    run?: ImportRunOptions,
  ): Promise<ImportJob> {
    const stored = await this.jobs.getJob(importJobId(provider, username));
    if (!stored) {
      throw new ImportServiceError('invalid-filters', 'No import job exists for this account yet.');
    }
    if (stored.status === 'completed') {
      return stored;
    }
    return this.start(
      { provider: stored.provider, username: stored.username, filters: stored.filters },
      run,
    );
  }

  /** Resume a failed import from its stored cursor (alias of `resume`). */
  retry(provider: ImportProvider, username: string, run?: ImportRunOptions): Promise<ImportJob> {
    return this.resume(provider, username, run);
  }

  // --- internals --------------------------------------------------------------

  private async runJob(job: ImportJob, run?: ImportRunOptions): Promise<ImportJob> {
    const adapter = this.adapters[job.provider];
    const window = resolveTimeFrame(job.filters.timeFrame, this.now());
    const selection = job.filters.timeControls;
    this.active.add(job.id);
    let current = job;
    let cursor: unknown = job.cursor;
    try {
      while (!isAbort(run?.signal)) {
        const page = await adapter.fetchPage(
          job.username,
          cursor,
          window,
          run?.signal ?? neverSignal(),
        );
        if (isAbort(run?.signal)) {
          current = markPaused(current, this.now());
          await this.persist(current, run);
          break;
        }
        if (isTerminalPage(page)) {
          current = markCompleted(patchJob(current, { cursor: null }, this.now()), this.now());
          await this.persist(current, run);
          break;
        }
        current = patchJob(
          current,
          {
            cursor: page.nextCursor,
            position: page.position,
          },
          this.now(),
        );
        current = await this.applyPage(current, page, window, selection);
        await this.persist(current, run);
        cursor = page.nextCursor;
        if (cursor === null) {
          current = markCompleted(patchJob(current, { cursor: null }, this.now()), this.now());
          await this.persist(current, run);
          break;
        }
      }
      if (isAbort(run?.signal) && current.status === 'running') {
        current = markPaused(current, this.now());
        await this.persist(current, run);
      }
    } catch (err) {
      current = isAbort(run?.signal)
        ? markPaused(current, this.now())
        : markFailed(current, humanizeError(err), this.now());
      await this.persist(current, run);
    } finally {
      this.active.delete(job.id);
    }
    return current;
  }

  private async applyPage(
    job: ImportJob,
    page: ProviderPageResult,
    window: TimeWindow,
    selection: ImportFilters['timeControls'],
  ): Promise<ImportJob> {
    const samples: Array<{ externalId: string | null; reason: string }> = [...page.skipped];
    const games: Game[] = [];
    let failed = 0;
    let filtered = 0;

    for (const record of page.records) {
      const outcome = providerGameToGame(record);
      if (outcome.kind === 'skip') {
        failed += 1;
        samples.push({ externalId: record.externalId, reason: outcome.message });
        continue;
      }
      const game = outcome.game;
      if (!timeControlsMatch(selection, game.normalizedTimeControl)) {
        filtered += 1;
        continue;
      }
      if (!playedAtInWindow(game.playedAt, window)) {
        filtered += 1;
        continue;
      }
      games.push(game);
    }

    let inserted = 0;
    let updated = 0;
    let duplicates = 0;
    for (let offset = 0; offset < games.length; offset += IMPORT_BATCH_SIZE) {
      const batch = games.slice(offset, offset + IMPORT_BATCH_SIZE);
      const results = await this.games.saveGames(batch);
      for (const result of results) {
        if (result.status === 'inserted') inserted += 1;
        else if (result.status === 'updated') updated += 1;
        else if (result.status === 'duplicate') duplicates += 1;
        else failed += 1;
      }
    }

    return patchJob(
      job,
      {
        addCounters: {
          seen: page.records.length,
          skipped: page.skipped.length,
          failed,
          filtered,
          inserted,
          updated,
          duplicates,
        },
        appendErrors: samples,
      },
      this.now(),
    );
  }

  private async persist(job: ImportJob, run?: ImportRunOptions): Promise<void> {
    await this.jobs.putJob(job);
    run?.onProgress?.(job);
  }

  private finishRun(job: ImportJob, run?: ImportRunOptions): ImportJob {
    run?.onProgress?.(job);
    return job;
  }
}

function isTerminalPage(page: ProviderPageResult): boolean {
  if (page.nextCursor !== null) {
    return false;
  }
  if (page.records.length > 0 || page.skipped.length > 0) {
    return false;
  }
  return true;
}

function isAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function neverSignal(): AbortSignal {
  return new AbortController().signal;
}

function humanizeError(err: unknown): string {
  if (err instanceof ProviderHttpError) {
    switch (err.code) {
      case 'player-not-found':
        return 'Player not found. Check the username and try again.';
      case 'rate-limited':
        return 'The provider rate-limited the request. Wait a minute and try again.';
      case 'forbidden':
        return 'The provider refused the request. Try again later.';
      case 'network':
        return 'Network error while contacting the provider. Check your connection.';
      case 'aborted':
        return 'Import stopped.';
      case 'http':
      case 'invalid-response':
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** True when the filters select the whole archive (fast path for callers). */
export function isUnfiltered(filters: ImportFilters): boolean {
  return filtersEqual(filters, {
    timeFrame: { preset: 'all' },
    timeControls: { kind: 'all' },
  });
}
