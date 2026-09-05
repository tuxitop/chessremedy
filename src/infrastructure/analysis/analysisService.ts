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
 *
 * Feature-010 completion hooks (optional dependencies): when a completed run
 * is persisted the per-analysis summary is written in the `queued` detection
 * state and — when a `TacticalDetectionService` is wired in — the two-stage
 * detection pass runs for the completed run (abort-aware). A forced
 * re-analysis also clears the superseded run's summary and puzzle-candidate
 * rows so the new run starts from an absent detection state. Detection is
 * derived data: it never fails or blocks an analysis batch.
 */

import type { EngineService, EngineAnalysisResult } from '@/infrastructure/engine/types';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import type { EngineAnalysisCache } from '@/infrastructure/engine/cache';
import { analysisCacheKey } from '@/infrastructure/engine/cache';
import { gameClocks } from '@/domain/chess';
import type { EngineMetadata, AnalysisProfile, EvalCpMate, MoveAnalysis } from '@/domain/chess';
import type { Game, GameId } from '@/domain/chess/game';
import { buildAnalysisSummary } from '@/domain/analysis/summaryDerivation';
import type { AnalysisSummariesRepository } from '@/infrastructure/db/summaries-repository';
import type { PuzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import type { TacticalDetectionService } from '@/infrastructure/tactics/tacticalDetectionService';
import {
  analysisJobId,
  analysisLibraryStatus,
  buildMoveAnalyses,
  jobForRun,
  markCancelled,
  markCompleted,
  markFailed,
  markProgress,
  patchJob,
  planGameAnalysis,
  type AnalysisJob,
  type EngineIdentity,
  type GameAnalysisStatus,
  type InputPositionResult,
} from '@/domain/analysis';
import type { GamesRepository } from '@/infrastructure/db/games-repository';
import type { AnalysisRepository } from '@/infrastructure/db/analysis-repository';
import type { AnalysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';

export interface AnalysisRunOptions {
  readonly signal?: AbortSignal;
  /** Force a re-analysis of already-completed games (engine/settings change). */
  readonly force?: boolean;
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
  /** Feature-010 per-analysis summary repository (optional completion hook). */
  readonly summaries?: AnalysisSummariesRepository | null;
  /** Feature-010 puzzle-candidate repository (optional completion hook). */
  readonly candidates?: PuzzleCandidatesRepository | null;
  /** Feature-010 two-stage detection service (optional completion hook). */
  readonly detection?: TacticalDetectionService | null;
  readonly now?: () => number;
}

type PositionOutcome =
  | { readonly kind: 'result'; readonly result: EngineAnalysisResult }
  | { readonly kind: 'failed'; readonly message: string };

export interface GameAnalysisProgress {
  readonly state: 'queued' | 'inProgress';
  readonly completedPositions: number;
  readonly totalPositions: number;
  readonly profile: AnalysisProfile;
}

export class AnalysisServiceError extends Error {}

export class AnalysisService {
  private readonly games: GamesRepository;
  private readonly analyses: AnalysisRepository;
  private readonly jobs: AnalysisJobsRepository;
  private readonly engine: EngineService;
  private readonly engineCache: EngineAnalysisCache | null;
  private readonly engineMetadata: (profile: AnalysisProfile) => EngineMetadata;
  private readonly summaries: AnalysisSummariesRepository | null;
  private readonly candidates: PuzzleCandidatesRepository | null;
  private readonly detection: TacticalDetectionService | null;
  private readonly now: () => number;
  private readonly currentEngine: EngineIdentity | null;
  /**
   * Per-game cancellation requests (per-row Cancel). Populated by
   * `cancelGame` for jobs that are queued/in-progress; consumed by the
   * in-flight batch runner at position boundaries so one game stops while the
   * rest of the batch continues. In-memory: the batch run and the UI cancel
   * share this service instance (persisted `cancelled` state is also written).
   */
  private readonly pendingCancels = new Set<GameId>();

  constructor(options: AnalysisServiceOptions) {
    this.games = options.games;
    this.analyses = options.analyses;
    this.jobs = options.jobs;
    this.engine = options.engine;
    this.engineCache = options.engineCache ?? null;
    this.engineMetadata = options.engineMetadata ?? this.defaultEngineMetadata.bind(this);
    this.summaries = options.summaries ?? null;
    this.candidates = options.candidates ?? null;
    this.detection = options.detection ?? null;
    this.now = options.now ?? (() => Date.now());
    this.currentEngine = this.resolveCurrentEngine();
  }

  private resolveCurrentEngine(): EngineIdentity | null {
    try {
      const meta = this.engineMetadata('normal');
      return {
        engineName: meta.engineName,
        engineVersion: meta.engineVersion,
        engineBuild: meta.engineBuild,
      };
    } catch {
      return null;
    }
  }

  /** UI-facing: analysis status of one game, from persisted state only. */
  async statusOf(gameId: GameId): Promise<GameAnalysisStatus> {
    return analysisLibraryStatus(
      await this.jobs.listByGame(gameId),
      this.currentEngine ?? undefined,
    );
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
      out[id] = analysisLibraryStatus(byGame.get(id) ?? [], this.currentEngine ?? undefined);
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
   * Cancel one game's queued/in-progress analysis (per-row cancel). Persisted
   * completed work for the game is untouched, and any running batch keeps
   * processing the other games: `runGameJob`/`analyzeGames` detect the
   * cancelled state at the next position/game boundary.
   */
  async cancelGame(gameId: GameId): Promise<void> {
    const jobs = await this.jobs.listByGame(gameId);
    const now = this.now();
    let cancelledAny = false;
    for (const job of jobs) {
      if (job.state === 'queued' || job.state === 'inProgress') {
        await this.persist(markCancelled(job, now));
        cancelledAny = true;
      }
    }
    if (cancelledAny) {
      this.pendingCancels.add(gameId);
    }
  }

  /**
   * Live progress for the selected games: the most recent active
   * (`queued`/`inProgress`) job per game, or `undefined` when the game is not
   * actively being analyzed. Used by the Library to surface per-game and
   * batch progress without fabricating ETAs.
   */
  async jobProgress(
    gameIds: readonly GameId[],
  ): Promise<Readonly<Record<string, GameAnalysisProgress | undefined>>> {
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
    const out: Record<string, GameAnalysisProgress | undefined> = {};
    for (const id of ids) {
      const candidates = (byGame.get(id) ?? []).filter(
        (job): job is AnalysisJob & { state: 'queued' | 'inProgress' } =>
          job.state === 'queued' || job.state === 'inProgress',
      );
      const active = [...candidates].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      out[id] = active
        ? {
            state: active.state,
            completedPositions: active.completedPositions,
            totalPositions: active.totalPositions,
            profile: active.engine.profile,
          }
        : undefined;
    }
    return out;
  }

  /**
   * Serializes full analysis batches: while one `analyzeGames` run is active,
   * further requests wait and start only after the current run finishes. A
   * later request never aborts an earlier run (Feature 008 §5). Each request
   * keeps its own `AbortSignal`; aborting it mid-run cancels its own jobs and
   * lets the next queued request proceed.
   */
  private runTail: Promise<unknown> = Promise.resolve();

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
    return this.enqueueRun(() => this.runAnalysisBatch(ids, profile, run));
  }

  /** Chain one batch after any currently running batch (FIFO, resilient). */
  private enqueueRun<T>(task: () => Promise<T>): Promise<T> {
    const run = this.runTail.then(task, task);
    this.runTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runAnalysisBatch(
    ids: readonly GameId[],
    profile: AnalysisProfile,
    run?: AnalysisRunOptions,
  ): Promise<readonly AnalysisJob[]> {
    const engine = this.engineMetadata(profile);
    // A new explicit run supersedes any earlier per-row cancels for these
    // games (e.g. a cancel-then-retry on the same game).
    for (const id of ids) {
      this.pendingCancels.delete(id);
    }

    const prepared: AnalysisJob[] = [];
    for (const gameId of ids) {
      let stored = await this.jobs.getJob(analysisJobId(gameId, engine));
      if (stored?.state === 'completed' && run?.force === true) {
        // A forced re-analysis clears the completed run's records and restarts
        // the same analysis identity under the current engine configuration.
        await this.analyses.deleteForAnalysis(stored.id);
        await this.clearDetectionState(stored.id);
        stored = undefined;
      }
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
    const perRowCancel = await this.maybeCancel(job, run);
    if (perRowCancel) {
      return perRowCancel;
    }
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
      // A per-row cancel stops this game at the next position boundary while
      // the rest of the batch continues.
      const stopped = await this.maybeCancel(current, run);
      if (stopped) {
        return stopped;
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

    // Final boundary check: a per-row cancel that lands during the last
    // position must still stop the game before records are persisted.
    const stoppedAtEnd = await this.maybeCancel(current, run);
    if (stoppedAtEnd) {
      return stoppedAtEnd;
    }

    // Completeness invariant (Feature 008 §24): a run is only ever persisted
    // `completed` when every required position produced a result. If the loop
    // above left a gap (e.g. a future resume path skips positions), fail the
    // job loudly instead of presenting a partial run as analyzed.
    const missing = plan.analyzeFens.filter((fen) => !results.has(fen));
    if (missing.length > 0) {
      const failed = markFailed(
        current,
        `Analysis incomplete: ${missing.length} required position(s) were not analyzed.`,
        this.now(),
      );
      await this.persist(failed, run);
      return failed;
    }

    let records;
    try {
      records = buildMoveAnalyses({
        job: current,
        moves: plan.moves,
        results,
        clocks: gameClocks(game.moves),
        nowMs: this.now(),
      });
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
    await this.writeQueuedSummary(current, game, records);
    await this.persist(current, run);
    await this.runDetection(current, game, records, run);
    return current;
  }

  /**
   * Persist the completed run's per-analysis summary with the detection pass
   * still `queued` (counts + accuracy filled, missed-tactic holder absent).
   * Feature-010 derived data: a write failure never fails the completed job.
   */
  private async writeQueuedSummary(
    job: AnalysisJob,
    game: Game,
    records: readonly MoveAnalysis[],
  ): Promise<void> {
    if (!this.summaries) {
      return;
    }
    try {
      const built = buildAnalysisSummary(records, game.userColor, { detectionState: 'queued' });
      await this.summaries.putForAnalysis({
        analysisId: job.id,
        gameId: game.id,
        userColor: game.userColor,
        updatedAt: this.now(),
        ...built,
      });
    } catch {}
  }

  /**
   * Trigger the Feature-010 two-stage detection pass for a completed run
   * (Stage 1 + Stage 2, abort-aware, cache-aware and idempotent per analysis
   * identity). Detection runs after the run's job is persisted; a failure here
   * never aborts the analysis batch.
   */
  private async runDetection(
    job: AnalysisJob,
    game: Game,
    records: readonly MoveAnalysis[],
    run?: AnalysisRunOptions,
  ): Promise<void> {
    if (!this.detection || run?.signal?.aborted) {
      return;
    }
    try {
      await this.detection.runPassForCompletedJob(
        job,
        { id: game.id, userColor: game.userColor },
        records,
        run?.signal,
      );
    } catch {}
  }

  /**
   * Remove one superseded analysis identity's Feature-010 derived rows
   * (summary + puzzle candidates) ahead of a forced re-analysis, so the new
   * run starts from an absent detection state. Best-effort: a cleanup failure
   * never blocks the re-analysis (the new completed run overwrites the rows).
   */
  private async clearDetectionState(analysisId: string): Promise<void> {
    if (this.summaries) {
      try {
        await this.summaries.deleteForAnalysis(analysisId);
      } catch {}
    }
    if (this.candidates) {
      try {
        await this.candidates.deleteForAnalysis(analysisId);
      } catch {}
    }
  }

  /**
   * Honour a per-row cancel request for this game: persist `cancelled` once and
   * return the cancelled job, or `null` when no cancel is pending. The request
   * is consumed here so a later retry is not affected.
   */
  private async maybeCancel(
    job: AnalysisJob,
    run?: AnalysisRunOptions,
  ): Promise<AnalysisJob | null> {
    if (!this.pendingCancels.has(job.gameId)) {
      return null;
    }
    this.pendingCancels.delete(job.gameId);
    const cancelled = markCancelled(job, this.now());
    await this.persist(cancelled, run);
    return cancelled;
  }

  /**
   * One position: serve from the ADR-018 cache when present (except on an
   * explicit forced re-analysis, which must genuinely re-run the engine),
   * else run a real engine job (off the UI thread) and store its result.
   */
  private async resolvePosition(
    fen: string,
    engine: EngineMetadata,
    run: AnalysisRunOptions | undefined,
  ): Promise<PositionOutcome> {
    const key = analysisCacheKey(fen, { profile: engine.profile }, engine);
    // A forced run bypasses the cache so "Re-analyze" always contacts the
    // worker (ADR-018: the cache is an optimization, not a substitute for an
    // explicit user-requested re-run). Fresh results are stored below.
    if (this.engineCache && run?.force !== true) {
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
      ...(line.depth !== undefined ? { depth: line.depth } : {}),
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
