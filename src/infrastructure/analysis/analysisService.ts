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
 * detection pass is scheduled for the completed run. Detection is derived
 * data: it never fails an analysis batch and it never holds the analysis queue
 * open — a game's job is `completed` (and the next queued game/batch starts)
 * as soon as its analysis is persisted, while detection runs in the background
 *  (abort-aware, idempotent, resumable, sharing the single engine FIFO). A
 *  forced re-analysis also clears the superseded run's summary and
 *  puzzle-candidate rows so the new run starts from an absent detection state.
 *
 * Feature-011 completion hook (optional dependency): when a detection pass
 * settles `completed` at the current `DETECTION_VERSION`, the engine-free
 * puzzle-generation pass is scheduled for the completed run (detached, never
 * blocking the analysis queue or the engine FIFO). Generation is derived data:
 * abort-aware, idempotent and resumable like detection, superseded on a forced
 * re-analysis (its live pass is cancelled first) and reconciled with orphaned
 * `inProgress` states on the session scan.
 */

import type { EngineService, EngineAnalysisResult } from '@/infrastructure/engine/types';
import type { EngineEvaluation } from '@/infrastructure/engine/types';
import type { EngineAnalysisCache } from '@/infrastructure/engine/cache';
import { analysisCacheKey } from '@/infrastructure/engine/cache';
import { gameClocks } from '@/domain/chess';
import type { EngineMetadata, AnalysisProfile, EvalCpMate, MoveAnalysis } from '@/domain/chess';
import type { Game, GameId } from '@/domain/chess/game';
import { buildAnalysisSummary } from '@/domain/analysis/summaryDerivation';
import { DETECTION_VERSION } from '@/domain/tactics';
import { latestCompletedJob } from '@/domain/analysis';
import type { AnalysisSummariesRepository } from '@/infrastructure/db/summaries-repository';
import type { PuzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import type { TacticalDetectionService } from '@/infrastructure/tactics/tacticalDetectionService';
import type { PuzzleGenerationService } from '@/infrastructure/puzzles/puzzleGenerationService';
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
  type ExpectedAnalysisConfig,
  type GameAnalysisConfig,
  type GameAnalysisStatus,
  type InputPositionResult,
} from '@/domain/analysis';
import type { GamesRepository } from '@/infrastructure/db/games-repository';
import type { AnalysisRepository } from '@/infrastructure/db/analysis-repository';
import type { AnalysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';

export type ScanGameOutcome =
  | 'started'
  | 'already-running'
  | 'already-completed'
  | 'analysis-in-progress'
  | 'no-completed-analysis'
  | 'no-records'
  | 'game-missing'
  | 'unavailable';

export type PuzzleGenerationOutcome =
  | 'started'
  | 'already-running'
  | 'already-completed'
  | 'analysis-in-progress'
  | 'no-completed-analysis'
  | 'game-missing'
  | 'detection-not-ready'
  | 'unavailable';

export interface ReconcileResult {
  /**
   * Owner-less `queued`/`inProgress` analysis jobs auto-resumed. Always `0`:
   * analysis orphans are **paused**, not re-run in the background (they are
   * resumed only by an explicit Analyze/Retry). Kept for API stability.
   */
  readonly resumedAnalysisJobs: number;
  /** Owner-less `inProgress` detection summaries relabelled `queued` (paused). */
  readonly pausedDetections: number;
  /**
   * Owner-less `inProgress` puzzle-generation summaries relabelled `queued`
   * (paused). Like detection, a generation pass is only genuinely running
   * while its game id is live in this session (Feature 011, Stage C).
   */
  readonly pausedGenerations: number;
}

export interface AnalysisRunOptions {
  readonly signal?: AbortSignal;
  /** Force a re-analysis of already-completed games (engine/settings change). */
  readonly force?: boolean;
  /**
   * Game-analysis depth/search-time overrides (Settings "Game analysis").
   * These flow into the job identity, the engine options and the ADR-018 cache
   * key. Absent = the profile's own defaults apply.
   */
  readonly config?: GameAnalysisConfig;
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
  /** Feature-011 engine-free puzzle-generation service (optional completion hook). */
  readonly generation?: PuzzleGenerationService | null;
  readonly now?: () => number;
}

type PositionOutcome =
  | { readonly kind: 'result'; readonly result: EngineAnalysisResult }
  | { readonly kind: 'failed'; readonly message: string };

/** One live detection pass: its cancellation handle + settled promise. */
interface ScanEntry {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

/** One live puzzle-generation pass: its cancellation handle + settled promise. */
interface GenerationEntry {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

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
  private readonly generation: PuzzleGenerationService | null;
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

  /**
   * Game ids whose analysis job is being processed right now **in this
   * session** (an in-flight `runGameJob`). Persisted `queued`/`inProgress`
   * analysis jobs whose game id is absent were scheduled by an earlier session
   * (or an interrupted run) and have no live owner — they are the orphans that
   * `reconcileOrphans()` auto-resumes once.
   */
  private readonly activeRuns = new Set<GameId>();

  /**
   * Live Feature-010 detection passes **in this session**, keyed by game id:
   * the pass's `AbortSignal` (so a scan can be cancelled / dropped by a forced
   * re-analysis) and its settled promise. A persisted summary row with
   * `detectionState: 'queued'/'inProgress'` only means a scan is genuinely
   * running while its game id is in this registry — a queued/in-progress
   * summary whose game id is absent was scheduled by an earlier session (or an
   * interrupted run) and is *not* actually scanning. The UI uses this to never
   * show "scanning…" when no scan is running, and the entry is removed by the
   * pass itself when it settles.
   */
  private readonly scans = new Map<GameId, ScanEntry>();

  /**
   * Live Feature-011 puzzle-generation passes **in this session**, keyed by
   * game id (mirror of `scans`). A persisted summary row with
   * `puzzleState: 'queued'/'inProgress'` only means a generation pass is
   * genuinely running while its game id is in this registry — a queued /
   * in-progress summary whose game id is absent was left by an earlier session
   * (or an interrupted run) and is *not* actually generating. The UI uses this
   * to never show "generating…" when no pass is running, and the entry is
   * removed by the pass itself when it settles.
   */
  private readonly generations = new Map<GameId, GenerationEntry>();

  /** Session guard: orphan analysis jobs are auto-resumed at most once. */
  private reconciledOnce = false;
  private reconcileRun: Promise<ReconcileResult> | null = null;

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
    this.generation = options.generation ?? null;
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

  /**
   * Number of distinct engine positions a game requires (its plan's
   * `analyzeFens`), or `0` when the game/plan is unavailable. Used at batch
   * prep so a persisted `queued` job already carries its real total.
   */
  private async positionTotalFor(gameId: GameId): Promise<number> {
    try {
      const game = await this.games.getGame(gameId);
      if (!game) {
        return 0;
      }
      const planned = planGameAnalysis(game);
      return planned.ok ? planned.plan.analyzeFens.length : 0;
    } catch {
      return 0;
    }
  }

  /** UI-facing: analysis status of one game, from persisted state only. */
  async statusOf(gameId: GameId, expected?: ExpectedAnalysisConfig): Promise<GameAnalysisStatus> {
    return analysisLibraryStatus(
      await this.jobs.listByGame(gameId),
      this.currentEngine ?? undefined,
      expected,
    );
  }

  /** UI-facing: analysis status of many games (Game Library). */
  async statusesOf(
    gameIds: readonly GameId[],
    expected?: ExpectedAnalysisConfig,
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
      out[id] = analysisLibraryStatus(
        byGame.get(id) ?? [],
        this.currentEngine ?? undefined,
        expected,
      );
    }
    return out;
  }

  /** Jobs that still need work (for restart/resume surfacing). */
  async listActiveJobs(): Promise<readonly AnalysisJob[]> {
    const queued = await this.jobs.listByState('queued');
    const inProgress = await this.jobs.listByState('inProgress');
    return [...inProgress, ...queued];
  }

  /** Live engine + service state for diagnosing "queued, no progress". */
  engineDebugStatus(): {
    readonly lifecycle: ReturnType<EngineService['getStatus']>['lifecycle'];
    readonly engineBuild: ReturnType<EngineService['getStatus']>['build'];
    readonly activeJobId: ReturnType<EngineService['getStatus']>['activeJobId'];
    readonly queuedEngineJobs: number;
    readonly activeAnalysisGames: readonly GameId[];
    readonly liveScanGames: readonly GameId[];
  } {
    const status = this.engine.getStatus();
    return {
      lifecycle: status.lifecycle,
      engineBuild: status.build,
      activeJobId: status.activeJobId,
      queuedEngineJobs: status.queued,
      activeAnalysisGames: [...this.activeRuns],
      liveScanGames: [...this.scans.keys()],
    };
  }

  /**
   * Feature-010 lazy backfill: for games whose latest completed analysis has no
   * per-analysis summary yet, derive and store one (`detectionState: 'absent'`)
   * so older analyzed games gain Library insights without a re-analysis. A no-op
   * when no detection service is wired. Returns the number of summaries created.
   */
  async ensureSummariesForRows(gameIds: readonly GameId[]): Promise<number> {
    if (!this.detection) {
      return 0;
    }
    try {
      return await this.detection.ensureSummariesForRows(gameIds);
    } catch {
      return 0;
    }
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
   * Run the Feature-010 tactics scan for a game's latest completed analysis
   * (standalone "Resume / Run tactics scan"). The scan-only entry point is
   * on-demand: it runs only the detection pass for the latest completed job
   * (ADR-018-cache aware, resumable, idempotent per analysis identity) and
   * never re-analyzes positions. The pass runs detached through the shared
   * engine FIFO and is registered as live so the UI can cancel it / show it.
   */
  async scanGame(gameId: GameId): Promise<ScanGameOutcome> {
    if (!this.detection) {
      return 'unavailable';
    }
    if (this.scans.has(gameId)) {
      return 'already-running';
    }
    const jobs = await this.jobs.listByGame(gameId);
    // A live analysis supersedes any scan of an older completed run.
    if (jobs.some((job) => job.state === 'queued' || job.state === 'inProgress')) {
      return 'analysis-in-progress';
    }
    const latest = latestCompletedJob(jobs);
    if (!latest) {
      return 'no-completed-analysis';
    }
    const game = await this.games.getGame(gameId);
    if (!game) {
      return 'game-missing';
    }
    if (this.summaries) {
      const existing = await this.summaries.getForAnalysis(latest.id);
      // A scan is only a no-op when the detection result was produced by the
      // current pipeline version. A completed summary from an older version is
      // outdated (plan 015 freshness gate): fall through so the pass re-runs
      // and wipes the stale result.
      if (
        existing?.detectionState === 'completed' &&
        existing.detectionVersion === DETECTION_VERSION
      ) {
        return 'already-completed';
      }
    }
    const records = await this.analyses.listForGameAndAnalysis(gameId, latest.id);
    if (records.length === 0) {
      return 'no-records';
    }
    this.startScan(latest, game, records);
    return 'started';
  }

  /**
   * Cancel a game's live tactics scan (Review/Library Cancel). The pass stops at
   * the next candidate boundary and leaves the summary resumable (`queued`).
   * The in-flight engine job is cancelled through the pass's `AbortSignal`.
   */
  async cancelScan(gameId: GameId): Promise<void> {
    this.scans.get(gameId)?.controller.abort();
  }

  /**
   * Game ids whose Feature-010 detection pass is running right now in this
   * session (the in-memory registry). The Library/Review read it to render an
   * accurate scan state: a persisted `queued`/`inProgress` summary without a
   * matching live id is an interrupted pass, not a running one.
   */
  async activeDetectionGames(): Promise<readonly GameId[]> {
    return [...this.scans.keys()];
  }

  /**
   * Generate / resume / retry the Feature-011 puzzle-generation pass for a
   * game's latest completed analysis (on-demand entry, mirror of `scanGame`).
   * Engine-free by construction: the pass does pure assembly + batched
   * IndexedDB writes over the analysis's verified candidates (Feature 011) and
   * is registered live through `startGeneration` so the Library/per-game view
   * can show it and cancel it. Only meaningful when the analysis's detection
   * pass already `completed` at the current `DETECTION_VERSION` — any other
   * state leaves the puzzle fields `absent` (the Library renders the
   * Feature-010 note) and is reported as `'detection-not-ready'`.
   */
  async generatePuzzles(gameId: GameId): Promise<PuzzleGenerationOutcome> {
    if (!this.generation) {
      return 'unavailable';
    }
    if (this.generations.has(gameId)) {
      return 'already-running';
    }
    const jobs = await this.jobs.listByGame(gameId);
    // A live analysis supersedes any pass of an older completed run.
    if (jobs.some((job) => job.state === 'queued' || job.state === 'inProgress')) {
      return 'analysis-in-progress';
    }
    const latest = latestCompletedJob(jobs);
    if (!latest) {
      return 'no-completed-analysis';
    }
    const game = await this.games.getGame(gameId);
    if (!game) {
      return 'game-missing';
    }
    if (this.summaries) {
      const existing = await this.summaries.getForAnalysis(latest.id);
      // A completed generation pass for this analysis identity is final (rows
      // are add-only); a stale detection result leaves generation `absent`
      // until a fresh refresh scan re-completes (plan R-6).
      if (existing?.puzzleState === 'completed') {
        return 'already-completed';
      }
      if (
        existing &&
        (existing.detectionState !== 'completed' || existing.detectionVersion !== DETECTION_VERSION)
      ) {
        return 'detection-not-ready';
      }
    }
    this.startGeneration(latest, game);
    return 'started';
  }

  /**
   * Game ids whose Feature-011 puzzle-generation pass is running right now in
   * this session (the in-memory registry, mirror of `activeDetectionGames`). A
   * persisted `queued`/`inProgress` puzzle summary without a matching live id
   * is an interrupted pass, not a running one.
   */
  async activeGenerationGames(): Promise<ReadonlySet<GameId>> {
    return new Set(this.generations.keys());
  }

  /**
   * Cancel a game's live puzzle-generation pass (Library/Review Cancel). The
   * pass stops at the next candidate boundary and leaves the summary resumable
   * (`queued`) with already-written puzzle rows persisted. Stage D wires the
   * UI; a forced re-analysis cancels + settles internally regardless.
   */
  async cancelGeneration(gameId: GameId): Promise<void> {
    this.generations.get(gameId)?.controller.abort();
  }

  /**
   * Game ids whose analysis job is being processed right now in this session
   * (the in-memory live-run registry). A persisted `queued`/`inProgress` job
   * whose game id is absent was left by an earlier session and is **paused** —
   * it is never silently re-run in the background and never reads as live.
   */
  async liveAnalysisGames(): Promise<readonly GameId[]> {
    return [...this.activeRuns];
  }

  /**
   * Reconcile orphaned work once per session. This is a **cheap, engine-free**
   * pass: owner-less `inProgress` detection summaries and owner-less
   * `inProgress` puzzle-generation summaries are relabelled `queued`
   * (resumable-paused) so nothing is ever silently "in progress" without a
   * live pass. Owner-less `queued`/`inProgress` **analysis** jobs are left
   * paused (never auto-resumed): silently replaying them on the shared,
   * serialized run queue made every later user action wait behind invisible
   * background work with no progress (they are resumed only by an explicit
   * Analyze/Retry action, which resumes them in place). Idempotent per
   * service instance; later calls return the first run's result.
   */
  reconcileOrphans(): Promise<ReconcileResult> {
    if (this.reconciledOnce && this.reconcileRun) {
      return this.reconcileRun;
    }
    this.reconciledOnce = true;
    const run = (async (): Promise<ReconcileResult> => {
      let pausedDetections = 0;
      let pausedGenerations = 0;
      try {
        pausedDetections = await this.pauseOrphanedDetections();
      } catch {
        // Best-effort; the next session re-runs the relabel.
      }
      try {
        pausedGenerations = await this.pauseOrphanedPuzzleGenerations();
      } catch {
        // Best-effort; the next session re-runs the relabel.
      }
      return { resumedAnalysisJobs: 0, pausedDetections, pausedGenerations };
    })();
    this.reconcileRun = run;
    return run;
  }

  /** Relabel owner-less `inProgress` detection summaries to resumable `queued`. */
  private async pauseOrphanedDetections(): Promise<number> {
    if (!this.summaries) {
      return 0;
    }
    let paused = 0;
    const all = await this.summaries.listAll();
    for (const summary of all) {
      const orphaned =
        summary.detectionState === 'inProgress' &&
        !this.scans.has(summary.gameId) &&
        !this.activeRuns.has(summary.gameId);
      if (!orphaned) {
        continue;
      }
      await this.summaries.putForAnalysis({
        ...summary,
        detectionState: 'queued',
        updatedAt: this.now(),
      });
      paused += 1;
    }
    return paused;
  }

  /** Relabel owner-less `inProgress` puzzle-generation summaries to `queued`. */
  private async pauseOrphanedPuzzleGenerations(): Promise<number> {
    if (!this.summaries) {
      return 0;
    }
    let paused = 0;
    const all = await this.summaries.listAll();
    for (const summary of all) {
      const orphaned =
        summary.puzzleState === 'inProgress' &&
        !this.generations.has(summary.gameId) &&
        !this.scans.has(summary.gameId) &&
        !this.activeRuns.has(summary.gameId);
      if (!orphaned) {
        continue;
      }
      await this.summaries.putForAnalysis({
        ...summary,
        puzzleState: 'queued',
        updatedAt: this.now(),
      });
      paused += 1;
    }
    return paused;
  }

  /**
   * Safe cleanup of stuck engine work (dev recovery helper): delete every
   * owner-less `queued`/`inProgress` analysis job and its incomplete derived
   * rows (partial `MoveAnalysis`, its summary, its puzzle candidates). Games
   * and **completed** analyses are untouched — the game library is never
   * modified. Interrupted runs simply vanish and can be re-run. Returns how
   * many stuck jobs were cleared.
   */
  async clearPausedAnalysisJobs(): Promise<number> {
    const stuck = await this.listActiveJobs();
    let cleared = 0;
    for (const job of stuck) {
      if (this.activeRuns.has(job.gameId) || this.scans.has(job.gameId)) {
        // Live this session: never delete work that is actually running.
        continue;
      }
      try {
        await this.analyses.deleteForAnalysis(job.id);
      } catch {
        // Best-effort per-row cleanup.
      }
      if (this.summaries) {
        try {
          await this.summaries.deleteForAnalysis(job.id);
        } catch {
          // Best-effort per-row cleanup.
        }
      }
      if (this.candidates) {
        try {
          await this.candidates.deleteForAnalysis(job.id);
        } catch {
          // Best-effort per-row cleanup.
        }
      }
      try {
        await this.jobs.deleteJob(job.id);
        cleared += 1;
      } catch {
        // Best-effort per-row cleanup.
      }
    }
    return cleared;
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
    const config = run?.config;
    // A new explicit run supersedes any earlier per-row cancels for these
    // games (e.g. a cancel-then-retry on the same game).
    for (const id of ids) {
      this.pendingCancels.delete(id);
    }

    const prepared: AnalysisJob[] = [];
    for (const gameId of ids) {
      let stored = await this.jobs.getJob(analysisJobId(gameId, engine, undefined, config));
      if (stored?.state === 'completed' && run?.force === true) {
        // A forced re-analysis clears the completed run's records and restarts
        // the same analysis identity under the current engine configuration. A
        // live/queued scan of that run is dropped first (its engine jobs
        // cancelled) so no ghost pass is left ahead in the engine FIFO, and its
        // abort path cannot resurrect the rows this cleanup deletes. A live
        // puzzle-generation pass of the same game is cancelled + settled for
        // the same reason (Feature 011 supersede: already-created puzzle rows
        // persist — the add-only repository never deletes them).
        await this.cancelScanAndSettle(gameId);
        await this.cancelGenerationAndSettle(gameId);
        await this.analyses.deleteForAnalysis(stored.id);
        await this.clearDetectionState(stored.id);
        stored = undefined;
      }
      // Total positions are known up front (planning is pure/cheap) so a
      // queued-but-not-started job already carries its real total — the queue
      // progress UI can sum the whole batch before a game starts.
      const totalPositions = await this.positionTotalFor(gameId);
      // Total positions are also patched when each job starts; queued here is
      // the persistent "needs work" marker that survives an application restart.
      const job = jobForRun(stored, gameId, engine, totalPositions, this.now(), config);
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

  /**
   * Run one game job to a terminal state, registering the game as "actively
   * analysed in this session" for the whole run so orphan reconciliation and
   * the live/queued UI never confuse a genuinely-running job with an
   * owner-less one left behind by an earlier session.
   */
  private async runGameJob(job: AnalysisJob, run?: AnalysisRunOptions): Promise<AnalysisJob> {
    this.activeRuns.add(job.gameId);
    try {
      return await this.runGameJobInner(job, run);
    } finally {
      this.activeRuns.delete(job.gameId);
    }
  }

  private async runGameJobInner(job: AnalysisJob, run?: AnalysisRunOptions): Promise<AnalysisJob> {
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
    // Detection is derived data and must never hold the analysis queue open
    // (Feature 008 §7/§10 + module header): the job is `completed` and the next
    // game of the batch / next queued batch starts as soon as this persist
    // lands, while the detection pass runs detached in the background (it is
    // abort-aware, idempotent and resumable, and shares the single engine FIFO).
    void this.startScan(current, game, records);
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
   * Start the Feature-010 two-stage detection pass for a completed run
   * (Stage 1 + Stage 2, cache-aware and idempotent per analysis identity).
   * Called detached (never awaited) from `runGameJob` after the run's job is
   * persisted `completed` (and by the on-demand `scanGame` entry point), so
   * detection never blocks the analysis queue. The pass runs through the
   * shared engine FIFO under its own `AbortSignal`; it is registered live for
   * its whole duration so the UI can tell a genuinely-running scan from a
   * persisted-but-interrupted one and can cancel it.
   */
  private startScan(
    job: AnalysisJob,
    game: Game,
    records: readonly MoveAnalysis[],
  ): ScanEntry | null {
    if (!this.detection) {
      return null;
    }
    const existing = this.scans.get(game.id);
    if (existing) {
      return existing;
    }
    const controller = new AbortController();
    const done = (async () => {
      try {
        await this.detection!.runPassForCompletedJob(
          job,
          { id: game.id, userColor: game.userColor },
          records,
          controller.signal,
        );
        // Feature-011 Stage C: when the settled detection verdict is
        // `completed` at the current DETECTION_VERSION, schedule the
        // engine-free puzzle-generation pass for the same completed run
        // (detached — generation never blocks the analysis queue or touches the
        // engine FIFO). Both trigger paths (the post-analysis auto-scan and the
        // on-demand `scanGame`) run through this continuation, so both
        // auto-trigger generation (plan R-1). Generation is idempotent per
        // analysis identity, so re-scheduling is harmless.
        await this.maybeAutoStartGeneration(job, game);
      } catch (err) {
        // Detection is derived data: a crash never fails the completed job,
        // but it must NEVER be swallowed silently — that left scans stuck at
        // "interrupted"/`inProgress` with no explanation. Log the real error
        // and surface the pass as `failed` so the user can retry it (the scan
        // report shows which candidates were already settled).
        console.error('[ChessRemedy] Tactics scan crashed:', err);
        if (this.summaries) {
          try {
            const existing = await this.summaries.getForAnalysis(job.id);
            if (existing && existing.detectionState !== 'completed') {
              await this.summaries.putForAnalysis({
                ...existing,
                detectionState: 'failed',
                updatedAt: this.now(),
              });
            }
          } catch {
            // Best-effort; the scan stays resumable either way.
          }
        }
      } finally {
        // Drop only our own pass: a newer scan may have replaced it.
        if (this.scans.get(game.id)?.controller === controller) {
          this.scans.delete(game.id);
        }
      }
    })();
    const entry: ScanEntry = { controller, done };
    this.scans.set(game.id, entry);
    return entry;
  }

  /**
   * Abort a game's live scan and await its settlement (used ahead of a forced
   * re-analysis so the superseded pass cannot resurrect its summary/candidates
   * after the cleanup below deletes them).
   */
  private async cancelScanAndSettle(gameId: GameId): Promise<void> {
    const entry = this.scans.get(gameId);
    if (!entry) {
      return;
    }
    entry.controller.abort();
    this.scans.delete(gameId);
    try {
      await entry.done;
    } catch {
      // The pass is abort-aware; a failure here is already contained.
    }
  }

  /**
   * Schedule the Feature-011 puzzle-generation pass for a completed run whose
   * detection has settled `completed` at the current version (plan R-1). The
   * pass is engine-free and runs detached under its own `AbortSignal`; it is
   * registered live for its whole duration so the UI can tell a
   * genuinely-running generation pass from a persisted-but-interrupted one and
   * can cancel it. Guarded per game: an already-live pass is returned as-is.
   */
  private startGeneration(job: AnalysisJob, game: Game): GenerationEntry | null {
    if (!this.generation) {
      return null;
    }
    const existing = this.generations.get(game.id);
    if (existing) {
      return existing;
    }
    const controller = new AbortController();
    const done = (async () => {
      try {
        await this.generation!.runPassForAnalysis(
          job.id,
          { id: game.id, userColor: game.userColor },
          controller.signal,
        );
      } catch (err) {
        // Generation is derived data: a crash never fails the completed
        // analysis, but it must NEVER be swallowed silently — log the real
        // error and surface the pass as `failed` so the user can retry it
        // (the service itself contains write/assembly failures into `failed`,
        // so this only fires for a failure it could not even record).
        console.error('[ChessRemedy] Puzzle generation crashed:', err);
        if (this.summaries) {
          try {
            const existing = await this.summaries.getForAnalysis(job.id);
            if (existing && existing.puzzleState !== 'completed') {
              await this.summaries.putForAnalysis({
                ...existing,
                puzzleState: 'failed',
                updatedAt: this.now(),
              });
            }
          } catch {
            // Best-effort; the pass stays resumable either way.
          }
        }
      } finally {
        // Drop only our own pass: a newer generation may have replaced it.
        if (this.generations.get(game.id)?.controller === controller) {
          this.generations.delete(game.id);
        }
      }
    })();
    const entry: GenerationEntry = { controller, done };
    this.generations.set(game.id, entry);
    return entry;
  }

  /**
   * After a detection pass settles, auto-trigger puzzle generation for the same
   * run when the settled verdict is `completed` at the current
   * `DETECTION_VERSION` (the generation service re-checks freshness itself, so
   * this gate only avoids scheduling a pass that would immediately no-op).
   * Best-effort: a scheduling failure never fails the scan's settlement.
   */
  private async maybeAutoStartGeneration(job: AnalysisJob, game: Game): Promise<void> {
    if (!this.generation || !this.summaries) {
      return;
    }
    try {
      const summary = await this.summaries.getForAnalysis(job.id);
      if (
        summary?.detectionState === 'completed' &&
        summary.detectionVersion === DETECTION_VERSION
      ) {
        this.startGeneration(job, game);
      }
    } catch {
      // Best-effort; generation is resumable on demand.
    }
  }

  /**
   * Abort a game's live puzzle-generation pass and await its settlement (used
   * ahead of a forced re-analysis so the superseded pass cannot write its
   * `queued`/`failed` state over the summary the cleanup below deletes). Puzzle
   * rows already created persist — the add-only repository never deletes them.
   */
  private async cancelGenerationAndSettle(gameId: GameId): Promise<void> {
    const entry = this.generations.get(gameId);
    if (!entry) {
      return;
    }
    entry.controller.abort();
    this.generations.delete(gameId);
    try {
      await entry.done;
    } catch {
      // The pass is abort-aware; a failure here is already contained.
    }
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
   * Game-analysis overrides (depth/search time) are folded into both the
   * engine request and the cache key so different configurations stay
   * distinguishable (Q2 = Option A).
   */
  private async resolvePosition(
    fen: string,
    engine: EngineMetadata,
    run: AnalysisRunOptions | undefined,
  ): Promise<PositionOutcome> {
    const config = run?.config;
    // A threads override of 1 is the single-threaded default, never an override:
    // drop it so a default run keeps the historical cache scope/identity.
    const threads =
      config?.threads !== undefined && config.threads > 1 ? config.threads : undefined;
    const scope = {
      profile: engine.profile,
      ...(config?.maxDepth !== undefined ? { maxDepth: config.maxDepth } : {}),
      ...(config?.movetimeMs !== undefined ? { movetimeMs: config.movetimeMs } : {}),
      ...(threads !== undefined ? { threads } : {}),
    };
    const key = analysisCacheKey(fen, scope, engine);
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

    const job = this.engine.analyze(fen, scope);
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
