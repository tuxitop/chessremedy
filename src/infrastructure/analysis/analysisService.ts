/**
 * Game-analysis orchestration service (Feature 008).
 *
 * Coordinates the Feature-005 Stockfish service and the Feature-004/007 game
 * store: for each selected game it plans the positions, runs them through the
 * engine (consulting the ADR-018 persistent position cache first), persists
 * the canonical `MoveAnalysis` records and tracks a persistent per-game job
 * through `queued → inProgress → completed | cancelled | failed`.
 *
 * Batch semantics follow the Feature-008 spec: one logical job per game,
 * independent failures, per-game progress, cancellation and restart-safe
 * resume (a restarted run resumes `queued`/`inProgress` jobs and skips
 * `completed` ones; positions already in the position-keyed cache are not
 * re-searched). Engine searches always run off the UI thread through the
 * Feature-005 Web Worker service.
 */

import type { EngineService, EngineAnalysisResult } from '@/infrastructure/engine/types';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import type { EngineAnalysisCache } from '@/infrastructure/engine/cache';
import { analysisCacheKey } from '@/infrastructure/engine/cache';
import type { EngineMetadata, AnalysisProfile, EvalCpMate } from '@/domain/chess';
import type { GameId } from '@/domain/chess/game';
import {
  analysisJobId,
  analysisStatusOf,
  buildMoveAnalyses,
  jobForRun,
  markCancelled,
  markCompleted,
  markFailed,
  markProgress,
  patchJob,
  planGameAnalysis,
  type AnalysisJob,
  type GameAnalysisStatus,
  type InputPositionResult,
} from '@/domain/analysis';
import type { GamesRepository } from '@/infrastructure/db/games-repository';
import type { AnalysisRepository } from '@/infrastructure/db/analysis-repository';
import type { AnalysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';

export interface AnalysisRunOptions {
  readonly signal?: AbortSignal;
  /** Notified whenever a job is persisted (progress / transitions). */
  readonly onJobProgress?: (job: AnalysisJob) => void;
}

export interface AnalysisServiceOptions {
  readonly games: GamesRepository;
  readonly analyses: AnalysisRepository;
  readonly jobs: AnalysisJobsRepository;
  readonly engine: EngineService;
  /** ADR-018 position-keyed cache; when absent positions are always searched. */
  readonly engineCache?: EngineAnalysisCache | null;
  /** Resolve the engine identity for a profile (browser assembly). */
  readonly engineMetadata?: (profile: AnalysisProfile) => EngineMetadata;
  readonly now?: () => number;
}

type PositionOutcome =
  | { readonly kind: 'result'; readonly result: EngineAnalysisResult }
  | { readonly kind: 'failed'; readonly message: string };

export class AnalysisServiceError extends Error {}

export class AnalysisService {
  private readonly games: GamesRepository;
  private readonly analyses: AnalysisRepository;
  private readonly jobs: AnalysisJobsRepository;
  private readonly engine: EngineService;
  private readonly engineCache: EngineAnalysisCache | null;
  private readonly engineMetadata: (profile: AnalysisProfile) => EngineMetadata;
  private readonly now: () => number;

  constructor(options: AnalysisServiceOptions) {
    this.games = options.games;
    this.analyses = options.analyses;
    this.jobs = options.jobs;
    this.engine = options.engine;
    this.engineCache = options.engineCache ?? null;
    this.engineMetadata = options.engineMetadata ?? this.defaultEngineMetadata.bind(this);
    this.now = options.now ?? (() => Date.now());
  }

  /** UI-facing: analysis status of one game, from persisted state only. */
  async statusOf(gameId: GameId): Promise<GameAnalysisStatus> {
    return analysisStatusOf(await this.jobs.listByGame(gameId));
  }

  /** UI-facing: analysis status of many games (Game Library). */
  async statusesOf(
    gameIds: readonly GameId[],
  ): Promise<Readonly<Record<string, GameAnalysisStatus>>> {
    const ids = [...new Set(gameIds)];
    if (ids.length === 0) {
      return {};
    }
    const jobs = await this.jobs.listByGames(ids);
    const byGame = new Map<string, AnalysisJob[]>();
    for (const job of jobs) {
      const list = byGame.get(job.gameId) ?? [];
      list.push(job);
      byGame.set(job.gameId, list);
    }
    const out: Record<string, GameAnalysisStatus> = {};
    for (const id of ids) {
      out[id] = analysisStatusOf(byGame.get(id) ?? []);
    }
    return out;
  }

  /** Jobs that still need work (for restart/resume surfacing). */
  async listActiveJobs(): Promise<readonly AnalysisJob[]> {
    const queued = await this.jobs.listByState('queued');
    const inProgress = await this.jobs.listByState('inProgress');
    return [...inProgress, ...queued];
  }

  /**
   * Analyze (or resume analyzing) the selected games under a profile. One
   * logical job per game, processed sequentially through the engine. A failure
   * in one game never aborts the batch; `completed` games are skipped.
   * Resolves with the job per game, aligned to `gameIds`.
   */
  async analyzeGames(
    gameIds: readonly GameId[],
    profile: AnalysisProfile = 'normal',
    run?: AnalysisRunOptions,
  ): Promise<readonly AnalysisJob[]> {
    const ids = [...new Set(gameIds)];
    const engine = this.engineMetadata(profile);

    const prepared: AnalysisJob[] = [];
    for (const gameId of ids) {
      const stored = await this.jobs.getJob(analysisJobId(gameId, engine));
      // Total positions are patched when each job starts; queued here is the
      // persistent "needs work" marker that survives an application restart.
      const job = jobForRun(stored, gameId, engine, 0, this.now());
      if (job.state === 'queued') {
        await this.jobs.putJob(job);
      }
      prepared.push(job);
    }

    const finals = new Map<GameId, AnalysisJob>();
    for (const job of prepared) {
      const gameId = job.gameId;
      if (job.state === 'completed') {
        finals.set(gameId, job);
        continue;
      }
      if (run?.signal?.aborted) {
        const cancelled = markCancelled(job, this.now());
        await this.persist(cancelled, run);
        finals.set(gameId, cancelled);
        continue;
      }
      const finalJob = await this.runGameJob(job, run);
      finals.set(gameId, finalJob);
    }

    return ids.map((id) => finals.get(id)!);
  }

  /** Analyze a single game (used by the Review surface). */
  async analyzeGame(
    gameId: GameId,
    profile: AnalysisProfile = 'normal',
    run?: AnalysisRunOptions,
  ): Promise<AnalysisJob> {
    const [job] = await this.analyzeGames([gameId], profile, run);
    return job!;
  }

  // --- internals --------------------------------------------------------------

  private defaultEngineMetadata(profile: AnalysisProfile): EngineMetadata {
    const status = this.engine.getStatus();
    if (!status.engine) {
      throw new AnalysisServiceError(
        'Engine is not ready. Run an analysis once to initialise Stockfish.',
      );
    }
    return { ...status.engine, profile };
  }

  private async runGameJob(job: AnalysisJob, run?: AnalysisRunOptions): Promise<AnalysisJob> {
    const game = await this.games.getGame(job.gameId);
    if (!game) {
      const failed = markFailed(job, 'The game no longer exists in the library.', this.now());
      await this.persist(failed, run);
      return failed;
    }
    const planResult = planGameAnalysis(game);
    if (!planResult.ok) {
      const failed = markFailed(job, planResult.message, this.now());
      await this.persist(failed, run);
      return failed;
    }
    const plan = planResult.plan;

    let current = patchJob(
      job,
      { state: 'inProgress', totalPositions: plan.analyzeFens.length },
      this.now(),
    );
    current = { ...current, startedAt: job.startedAt ?? this.now() };
    await this.persist(current, run);

    const results = new Map<string, InputPositionResult>();
    for (let index = 0; index < plan.analyzeFens.length; index += 1) {
      if (run?.signal?.aborted) {
        const cancelled = markCancelled(current, this.now());
        await this.persist(cancelled, run);
        return cancelled;
      }
      const fen = plan.analyzeFens[index]!;
      const outcome = await this.resolvePosition(fen, job.engine, run);
      if (run?.signal?.aborted) {
        const cancelled = markCancelled(current, this.now());
        await this.persist(cancelled, run);
        return cancelled;
      }
      if (outcome.kind === 'failed') {
        const failed = markFailed(current, outcome.message, this.now());
        await this.persist(failed, run);
        return failed;
      }
      results.set(fen, toInputPositionResult(outcome.result));
      current = markProgress(current, index + 1, this.now());
      await this.persist(current, run);
    }

    let records;
    try {
      records = buildMoveAnalyses({ job: current, moves: plan.moves, results, nowMs: this.now() });
    } catch (err) {
      const failed = markFailed(
        current,
        err instanceof Error ? `${err.message} :: ${err.stack ?? ''}` : String(err),
        this.now(),
      );
      await this.persist(failed, run);
      return failed;
    }
    await this.analyses.replaceAnalysis(records);

    current = markCompleted(current, this.now());
    await this.persist(current, run);
    return current;
  }

  /**
   * One position: serve from the ADR-018 cache when present, else run a real
   * engine job (off the UI thread) and store its result.
   */
  private async resolvePosition(
    fen: string,
    engine: EngineMetadata,
    run: AnalysisRunOptions | undefined,
  ): Promise<PositionOutcome> {
    const key = analysisCacheKey(fen, { profile: engine.profile }, engine);
    if (this.engineCache) {
      const cached = await this.engineCache.get(key);
      if (cached) {
        return { kind: 'result', result: cached };
      }
    }
    if (run?.signal?.aborted) {
      return { kind: 'failed', message: 'Analysis cancelled.' };
    }

    const job = this.engine.analyze(fen, { profile: engine.profile });
    const outcome = await Promise.race([job.outcome, abortSignal(run?.signal)]);
    if (outcome === 'aborted') {
      job.cancel();
      return { kind: 'failed', message: 'Analysis cancelled.' };
    }
    if (outcome.kind === 'cancelled') {
      return { kind: 'failed', message: 'Analysis cancelled.' };
    }
    if (outcome.kind === 'failed') {
      return { kind: 'failed', message: outcome.error.message };
    }
    if (this.engineCache) {
      await this.engineCache.put(key, outcome.result);
    }
    return { kind: 'result', result: outcome.result };
  }

  private async persist(job: AnalysisJob, run?: AnalysisRunOptions): Promise<void> {
    await this.jobs.putJob(job);
    run?.onJobProgress?.(job);
  }
}

function toEvalCpMate(evaluation: EngineEvaluation): EvalCpMate {
  return 'mate' in evaluation
    ? { cp: null, mate: evaluation.mate }
    : { cp: evaluation.cp, mate: null };
}

/** Map an engine result onto the domain-neutral analysis input shape. */
function toInputPositionResult(result: EngineAnalysisResult): InputPositionResult {
  return {
    fen: result.position,
    profile: result.profile,
    lines: result.lines.map((line) => ({
      multipv: line.multipv,
      uci: line.principalVariation.map((move) => move.uci),
      evaluation: toEvalCpMate(line.evaluation),
      wdl: line.wdl,
    })),
  };
}

function abortSignal(signal: AbortSignal | undefined): Promise<'aborted' | never> {
  if (!signal) {
    return new Promise<never>(() => undefined);
  }
  if (signal.aborted) {
    return Promise.resolve('aborted' as const);
  }
  return new Promise((resolve) => {
    const listener = (): void => {
      signal.removeEventListener('abort', listener);
      resolve('aborted' as const);
    };
    signal.addEventListener('abort', listener);
  });
}
