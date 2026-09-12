/**
 * Tactical detection orchestration service (Feature 010, Milestone A).
 *
 * Runs the two-stage detection pass (ADR-026) for one completed analysis run
 * over its persisted `MoveAnalysis` records, coordinating the pure domain
 * pipeline (`src/domain/tactics`) with the engine infrastructure and the
 * Feature-010 persistence (per-analysis summaries, puzzle candidates):
 *
 * 1. Stage 1 (`generateCandidates`) runs inline over the run's records —
 *    pure, fast, no engine work.
 * 2. Each raw candidate (sorted by `sourcePly`) is verified with a
 *    `tactical`-profile engine run behind the ADR-018 position-keyed cache
 *    (cache key via `analysisCacheKey` with the candidate's starting FEN, the
 *    tactical profile and the engine identity).
 * 3. Verified candidates are persisted game-scoped (`verified` rows), the
 *    owning `MoveAnalysis` plies are annotated in place
 *    (`missedTactic` / `detectionVersion` via the pure
 *    `annotateVerifiedMisses` merge) and the per-analysis summary is kept in
 *    sync through the detection-pass state machine
 *    (`absent → queued → inProgress → completed | failed`,
 *    `domain/tactics.md` §"Detection-pass state model").
 *
 * ## Failure/interruption handling (documented reading)
 *
 * A candidate whose verification run yields a definitive verdict — verified,
 * or rejected by a Stage-2 guard (`verifyCandidate` returned a rejection
 * reason, i.e. the candidate is *discarded* — ADR-026 "Unverified raw
 * candidates are discarded after the run") — is settled. A rejected
 * candidate's row is still marked `failed` so the discard is visible and the
 * pass is never silently "done". A candidate whose *engine run itself* fails
 * (job failure, cancellation, exception) is NOT settled: it is retried in the
 * same pass up to `MAX_ENGINE_ATTEMPTS_PER_CANDIDATE`; if it still fails it is
 * **deferred** (row marked `failed`, verification continues with the rest of
 * the game — plan-013 fix A) and the pass ends `failed` so the next scan
 * retries only the deferred candidate (everything else is reused/cached, so a
 * retry is cheap and one flaky position can never repeatedly fail a whole
 * long game). Each tactical search is additionally bounded by
 * `VERIFY_MOVETIME_MS` (plan-013 fix C), so a pathological position cannot
 * hold a search open indefinitely (ADR-026 failure modes).
 *
 * An aborted pass (caller `AbortSignal`) stops at the next candidate boundary,
 * leaving already-verified rows persisted and the summary back at `queued` —
 * a completed analysis whose pass is scheduled but not yet settled. The next
 * invocation resumes: Stage-1 candidates that already have a `verified` row
 * are reused without an engine run (their annotations are re-applied to the
 * records passed in), every other candidate is re-verified (the ADR-018 cache
 * absorbs positions verified by earlier attempts).
 *
 * The pass is idempotent per analysis identity: an invocation whose summary is
 * already `completed` by the **current** detection version returns without
 * touching anything. A `completed` summary (or `verified` rows / `missedTactic`
 * annotations) written by an older `DETECTION_VERSION` is stale: the pass wipes
 * those artifacts and re-derives detection from scratch (plan 015 freshness
 * gate), so a verdict produced under superseded rules never survives a version
 * bump until a fresh scan replaces it.
 *
 * `ensureSummariesForRows` is the Milestone-B lazy-backfill entrypoint: for
 * games that have a completed/latest analysis but no summary row it derives
 * and stores the per-analysis summary with `detectionState: 'absent'`
 * (counts/accuracy filled, missed-tactic holder `null`). It never runs a
 * detection pass and never scans `MoveAnalysis` beyond the completed
 * analysis's own rows.
 */

import type { Color } from 'chessops/types';
import type { AnalysisJob } from '@/domain/analysis';
import { latestCompletedJob } from '@/domain/analysis';
import type { MoveAnalysis } from '@/domain/chess';
import type { EngineMetadata } from '@/domain/chess';
import type { GameId } from '@/domain/chess/game';
import { buildAnalysisSummary } from '@/domain/analysis/summaryDerivation';
import type {
  BuildAnalysisSummaryOptions,
  ScanProgress,
  SummaryDetectionState,
} from '@/domain/analysis/summaryDerivation';
import {
  annotateVerifiedMisses,
  clearAllMissedTacticAnnotations,
  DETECTION_VERSION,
  fastPathVerifiedCandidate,
  generateCandidates,
  verifyCandidate,
} from '@/domain/tactics';
import type {
  RawCandidate,
  TacticalCandidateLine,
  VerificationRejectionReason,
  VerifiedTacticalCandidate,
} from '@/domain/tactics';
import type { AnalysisRepository } from '@/infrastructure/db/analysis-repository';
import type { AnalysisJobsRepository } from '@/infrastructure/db/analysis-jobs-repository';
import type {
  PuzzleCandidatesRepository,
  PuzzleCandidateRow,
  UnverifiedPuzzleCandidateRow,
  CandidateVerificationLine,
} from '@/infrastructure/db/candidates-repository';
import type { GamesRepository } from '@/infrastructure/db/games-repository';
import type {
  AnalysisSummariesRepository,
  AnalysisSummaryRow,
} from '@/infrastructure/db/summaries-repository';
import { analysisCacheKey } from '@/infrastructure/engine/cache';
import type { EngineAnalysisCache } from '@/infrastructure/engine/cache';
import { VERIFICATION_THREADS } from '@/infrastructure/engine/capabilities';
import type { EngineLine } from '@/infrastructure/engine/types';
import type { EngineAnalysisResult, EngineService } from '@/infrastructure/engine/types';
import { DEFAULT_VERIFICATION_DEPTH, clampVerificationDepth } from './verificationDepth';

/**
 * Bounded search time for one candidate's tactical verification (plan-013
 * fix C). The tactical profile stays depth-bounded (ADR-012 depth 22); this
 * movetime cap backstops it so a pathological position can never hold a search
 * (and therefore the whole game's scan) for an unbounded time. The engine
 * stops at whichever limit it reaches first.
 */
export const VERIFY_MOVETIME_MS = 45_000;

/**
 * Engine attempts per candidate before the candidate is deferred (plan-013
 * fix A): a transient worker crash/timeout is retried once in the same pass;
 * a candidate that still fails after that is skipped so the rest of the game's
 * scan completes, and the pass ends `failed` only so the unresolved candidate
 * can be retried (cheaply — everything else is cached or reused).
 */
export const MAX_ENGINE_ATTEMPTS_PER_CANDIDATE = 2;

export interface TacticalDetectionServiceOptions {
  readonly engine: EngineService;
  /**
   * Fixed effective verification depth (tests / back-compat). Ignored when
   * `resolveVerificationDepth` is supplied; clamped per pass. Defaults to
   * `DEFAULT_VERIFICATION_DEPTH` (22) when neither is given.
   */
  readonly verificationDepth?: number;
  /**
   * Live verification-depth provider (Settings `analysis.tacticalDetection`).
   * Resolved and clamped **once per pass**, so every Stage-2 search of one
   * pass uses the same effective depth.
   */
  readonly resolveVerificationDepth?: () => number | Promise<number>;
  /** ADR-018 position-keyed cache; when absent positions are always searched. */
  readonly engineCache?: EngineAnalysisCache | null;
  readonly analyses: AnalysisRepository;
  readonly candidates: PuzzleCandidatesRepository;
  readonly summaries: AnalysisSummariesRepository;
  /** Required by `ensureSummariesForRows` (Milestone-B lazy backfill). */
  readonly jobs?: AnalysisJobsRepository;
  /** Required by `ensureSummariesForRows` (Milestone-B lazy backfill). */
  readonly games?: GamesRepository;
  readonly now?: () => number;
}

type EngineIdentity = Pick<EngineMetadata, 'engineName' | 'engineVersion' | 'engineBuild'>;

type VerificationOutcome =
  | { readonly kind: 'verified'; readonly candidate: VerifiedTacticalCandidate }
  | {
      readonly kind: 'rejected';
      readonly reason: VerificationRejectionReason;
      /** Engine's top line the rejection was judged against (for the report). */
      readonly line?: CandidateVerificationLine;
    }
  | { readonly kind: 'engine-failed'; readonly message: string }
  | { readonly kind: 'aborted' };

export interface BackfillOptions {
  readonly signal?: AbortSignal;
}

export class TacticalDetectionService {
  private readonly engine: EngineService;
  private readonly engineCache: EngineAnalysisCache | null;
  private readonly analyses: AnalysisRepository;
  private readonly candidates: PuzzleCandidatesRepository;
  private readonly summaries: AnalysisSummariesRepository;
  private readonly jobs: AnalysisJobsRepository | null;
  private readonly games: GamesRepository | null;
  private readonly now: () => number;
  private readonly fixedVerificationDepth: number | null;
  private readonly resolveVerificationDepth: (() => number | Promise<number>) | null;

  constructor(options: TacticalDetectionServiceOptions) {
    this.engine = options.engine;
    this.engineCache = options.engineCache ?? null;
    this.analyses = options.analyses;
    this.candidates = options.candidates;
    this.summaries = options.summaries;
    this.jobs = options.jobs ?? null;
    this.games = options.games ?? null;
    this.now = options.now ?? (() => Date.now());
    this.fixedVerificationDepth =
      options.verificationDepth !== undefined
        ? clampVerificationDepth(options.verificationDepth)
        : null;
    this.resolveVerificationDepth = options.resolveVerificationDepth ?? null;
  }

  /**
   * Resolve the effective verification depth for one pass (ADR-026/ADR-034):
   * the live provider when supplied, else the fixed option, else the default
   * 22 — always clamped. Called once per pass so every Stage-2 search in the
   * pass shares the same depth (and cache scope).
   */
  private async effectiveVerificationDepth(): Promise<number> {
    if (this.resolveVerificationDepth) {
      return clampVerificationDepth(await this.resolveVerificationDepth());
    }
    return this.fixedVerificationDepth ?? DEFAULT_VERIFICATION_DEPTH;
  }

  /**
   * Run the whole two-stage detection pass for one completed analysis run.
   * `job` is the completed analysis job (its id is the `analysisId` scope key),
   * `game` supplies the game id and the importing user's color, `records` are
   * the run's persisted `MoveAnalysis`. Abort-aware, cache-aware and resumable
   * (see the module header).
   *
   * Scan progress (plan 013 W3): Stage 1's candidate set size is written as
   * the pass's `total` and `done` is advanced (and persisted) as each
   * candidate settles — verified, or rejected/failed by a Stage-2 guard.
   * Already-verified rows of a resumed pass count as done immediately, so an
   * interrupted scan restores its real totals. `queued`/`inProgress` states
   * carry the additive `scanProgress`; the UI renders a bar from it only while
   * the pass is live in this session.
   */
  async runPassForCompletedJob(
    job: AnalysisJob,
    game: { readonly id: string; readonly userColor: Color },
    records: readonly MoveAnalysis[],
    signal?: AbortSignal,
    options: { readonly force?: boolean } = {},
  ): Promise<void> {
    if (signal?.aborted) {
      return;
    }
    const existing = await this.summaries.getForAnalysis(job.id);
    // Idempotency: an invocation whose summary is already completed **by the
    // current pipeline version** returns without touching anything. A completed
    // summary written by an older DETECTION_VERSION is NOT trusted: its verdicts
    // were produced under rules that no longer apply, so the pass re-runs and
    // wipes its artifacts (plan 015 freshness gate).
    //
    // Depth is deliberately **not** consulted here (ADR-026/ADR-034): a
    // completed pass stays current while its `detectionVersion` matches the
    // current constant, whatever depth it was produced at, so changing the
    // verification-depth setting never marks a result outdated and never
    // auto-runs a scan. Applying a changed depth is the explicit `force` path.
    if (
      options.force !== true &&
      existing?.detectionState === 'completed' &&
      existing.detectionVersion === DETECTION_VERSION
    ) {
      return;
    }
    if (signal?.aborted) {
      return;
    }

    // Resolve the effective depth once per pass; every Stage-2 search (and the
    // cache scope) uses this value for the whole pass.
    const verificationDepth = await this.effectiveVerificationDepth();
    if (signal?.aborted) {
      return;
    }

    // Reaching here means the pass will (re)derive detection. If an older
    // pipeline version already wrote detection artifacts, they are stale and
    // must be wiped so this run starts clean — in particular a ply that no
    // longer surfaces as a Stage-1 candidate (or no longer verifies) must lose
    // its old `verified` row and `missedTactic` annotation instead of surviving
    // forever (plan 015). The wipe also runs for an empty pass: a game that
    // re-detects to zero candidates can still carry a stale marker that has to
    // go. It fires on a depth mismatch too: a re-scan at a changed depth must
    // not reuse verdicts produced at another depth.
    const storedRows = await this.candidates.listForGameAndAnalysis(game.id, job.id);
    let stored: readonly PuzzleCandidateRow[] = storedRows;
    const hasStaleRows = storedRows.some(
      (row) =>
        row.verificationStatus === 'verified' &&
        (row.detectionVersion !== DETECTION_VERSION ||
          row.verificationMetadata.verificationDepth !== verificationDepth),
    );
    const hasStaleCompleted =
      existing?.detectionState === 'completed' &&
      (existing.detectionVersion !== DETECTION_VERSION ||
        (existing.verificationDepth ?? null) !== verificationDepth);
    const hasStaleAnnotations = records.some(
      (record) => record.missedTactic && record.detectionVersion !== DETECTION_VERSION,
    );
    if (hasStaleCompleted || hasStaleRows || hasStaleAnnotations) {
      await this.candidates.deleteForAnalysis(job.id);
      // A wipe is a full re-derivation, so clear **every** missed-tactic
      // annotation (a record written at another depth carries no depth, so it
      // cannot be distinguished from one this pass will re-derive) and re-apply
      // from the freshly verified set below.
      const cleared = clearAllMissedTacticAnnotations(records);
      if (cleared !== records) {
        // Persist the de-annotated records so the MoveAnalysis table no longer
        // carries flags this pass will not re-derive.
        await this.analyses.replaceAnalysis(cleared);
      }
      // The rest of the pass derives summaries and annotations from the cleared
      // base, never from the stale-annotated input.
      records = cleared;
      // The candidate table is empty now: the snapshot above referenced rows
      // this wipe just deleted, so the reuse map below must not resurrect them
      // without re-persisting (plan 015). Start the resumability map from the
      // empty post-wipe table.
      stored = [];
    }

    // Stage-1 output is already capped per game and ordered by swing size
    // (plan 013 W1/W4), so verification runs the biggest moments first.
    const candidates = generateCandidates(records, game.userColor, this.now());
    const total = candidates.length;

    // An empty pass still completes: a real zero is written with the detection
    // version so the Library never renders this analysis as absent-detection.
    if (total === 0) {
      await this.writeSummary(
        job,
        game,
        records,
        'completed',
        {
          missedTacticCount: 0,
          detectionVersion: DETECTION_VERSION,
          scanProgress: { done: 0, total: 0 },
          verificationDepth,
        },
        // This write STARTS a fresh (re)derivation: reset any puzzle fields.
        { carryPuzzleFields: false },
      );
      return;
    }
    if (signal?.aborted) {
      return;
    }

    // Resumability: candidates that already carry a `verified` row written by
    // the **current** detection version **at the effective depth** (an earlier,
    // interrupted or failed pass) are reused without an engine run; every other
    // candidate is (re)persisted as `raw` BEFORE Stage 2 so an interruption
    // never loses the candidate set. Rows from older versions or another depth
    // are wiped above and filtered here as a defensive backstop.
    const verifiedByPly = new Map<number, VerifiedTacticalCandidate>();
    for (const row of stored) {
      if (
        row.verificationStatus === 'verified' &&
        row.detectionVersion === DETECTION_VERSION &&
        row.verificationMetadata.verificationDepth === verificationDepth
      ) {
        verifiedByPly.set(row.sourcePly, row);
      }
    }
    const pending = candidates
      .filter((candidate) => !verifiedByPly.has(candidate.sourcePly))
      .map((candidate): UnverifiedPuzzleCandidateRow => ({
        ...candidate,
        verificationStatus: 'raw',
      }));
    await this.candidates.bulkPutForAnalysis(pending);

    // Progress starts from the already-verified rows of a resumed pass.
    let settledCount = Math.min(total, verifiedByPly.size);
    await this.writeSummary(
      job,
      game,
      records,
      'inProgress',
      { scanProgress: { done: settledCount, total }, verificationDepth },
      // This write STARTS a fresh (re)derivation: reset any puzzle fields.
      { carryPuzzleFields: false },
    );

    const engineIdentity = this.resolveEngineIdentity(job);
    // The detection pass uses the dedicated verification engine's own thread
    // count (ADR-034) and never inherits the Game-analysis run's `threads`
    // override (Feature 008 §3 superseded): the verification engine is fixed at
    // VERIFICATION_THREADS (1). The depth is the pass's effective setting.
    const verified: VerifiedTacticalCandidate[] = [];
    let deferredFailures = 0;
    const recordsByPly = new Map<number, MoveAnalysis>();
    for (const record of records) {
      recordsByPly.set(record.ply, record);
    }

    for (const candidate of candidates) {
      if (signal?.aborted) {
        await this.writeSummary(job, game, records, 'queued', {
          scanProgress: { done: settledCount, total },
          verificationDepth,
        });
        return;
      }
      const reused = verifiedByPly.get(candidate.sourcePly);
      if (reused) {
        verified.push(reused);
        await this.persistAnnotatedRecords(records, verified);
        continue;
      }

      // WP-C fast path: when the run's own stored analysis of this position is
      // a decisive complete mate line (same engine, deep enough), the mate is a
      // deterministic board fact — verify without a fresh tactical engine run.
      const storedRecord = recordsByPly.get(candidate.sourcePly);
      if (storedRecord) {
        const fast = this.fastPathCandidate(candidate, engineIdentity, storedRecord);
        if (fast) {
          await this.candidates.bulkPutForAnalysis([fast]);
          verified.push(fast);
          settledCount += 1;
          await this.persistScanProgress(
            job,
            game,
            records,
            settledCount,
            total,
            verificationDepth,
          );
          await this.persistAnnotatedRecords(records, verified);
          continue;
        }
      }

      const outcome = await this.verifyCandidateWithEngine(
        candidate,
        engineIdentity,
        verificationDepth,
        signal,
      );
      if (outcome.kind === 'aborted') {
        await this.writeSummary(job, game, records, 'queued', {
          scanProgress: { done: settledCount, total },
          verificationDepth,
        });
        return;
      }
      if (outcome.kind === 'engine-failed') {
        // A transient engine failure (worker crash, timeout, cancel) is retried
        // within the same pass up to MAX_ENGINE_ATTEMPTS_PER_CANDIDATE before
        // the candidate is deferred. One flaky position must not abort the scan
        // of the rest of a long game.
        let settled: VerificationOutcome = outcome;
        for (
          let attempt = 1;
          attempt < MAX_ENGINE_ATTEMPTS_PER_CANDIDATE && settled.kind === 'engine-failed';
          attempt += 1
        ) {
          if (signal?.aborted) {
            await this.writeSummary(job, game, records, 'queued', {
              scanProgress: { done: settledCount, total },
              verificationDepth,
            });
            return;
          }
          settled = await this.verifyCandidateWithEngine(
            candidate,
            engineIdentity,
            verificationDepth,
            signal,
          );
          if (settled.kind === 'aborted') {
            await this.writeSummary(job, game, records, 'queued', {
              scanProgress: { done: settledCount, total },
              verificationDepth,
            });
            return;
          }
        }
        if (settled.kind === 'engine-failed') {
          // Still failing after the bounded retries: defer this candidate (NOT
          // settled — its row stays failed so the next scan retries only it)
          // and continue verifying the rest of the game.
          deferredFailures += 1;
          await this.candidates.updateStatus(job.id, candidate.sourcePly, 'failed');
          continue;
        }
        if (settled.kind === 'verified') {
          await this.candidates.bulkPutForAnalysis([settled.candidate]);
          verified.push(settled.candidate);
          settledCount += 1;
          await this.persistScanProgress(
            job,
            game,
            records,
            settledCount,
            total,
            verificationDepth,
          );
          await this.persistAnnotatedRecords(records, verified);
          continue;
        }
        // settled.kind === 'rejected'
        settledCount += 1;
        await this.candidates.updateRejected(
          job.id,
          candidate.sourcePly,
          settled.reason,
          settled.line,
        );
        await this.persistScanProgress(job, game, records, settledCount, total, verificationDepth);
        continue;
      }
      if (outcome.kind === 'rejected') {
        // A Stage-2 guard gave a definitive verdict: the candidate is settled
        // (discarded) and counts towards the scan progress. The guard reason is
        // persisted so the scan report can explain why it was rejected.
        settledCount += 1;
        await this.candidates.updateRejected(
          job.id,
          candidate.sourcePly,
          outcome.reason,
          outcome.line,
        );
        await this.persistScanProgress(job, game, records, settledCount, total, verificationDepth);
        continue;
      }
      await this.candidates.bulkPutForAnalysis([outcome.candidate]);
      verified.push(outcome.candidate);
      settledCount += 1;
      await this.persistScanProgress(job, game, records, settledCount, total, verificationDepth);
      await this.persistAnnotatedRecords(records, verified);
    }

    if (signal?.aborted) {
      await this.writeSummary(job, game, records, 'queued', {
        scanProgress: { done: settledCount, total },
        verificationDepth,
      });
      return;
    }
    if (deferredFailures > 0) {
      // Everything that could settle did; only deferred (engine-failing)
      // candidates remain. Surface `failed` so the user can retry the scan —
      // the retry is cheap: verified rows are reused and searched positions
      // are served from the ADR-018 cache, so only the deferred candidates
      // actually run the engine again.
      await this.writeSummary(job, game, records, 'failed', {
        scanProgress: { done: settledCount, total },
        verificationDepth,
      });
      return;
    }
    await this.writeSummary(job, game, records, 'completed', {
      missedTacticCount: verified.length,
      detectionVersion: DETECTION_VERSION,
      scanProgress: { done: total, total },
      verificationDepth,
    });
  }

  /**
   * Milestone-B lazy backfill: derive and store an `absent`-detection summary
   * for every listed game that has a completed/latest analysis and no summary
   * row yet. Returns how many summaries it created. Never runs a detection
   * pass. Requires the `jobs` and `games` repositories (constructor options).
   */
  async ensureSummariesForRows(
    gameIds: readonly GameId[],
    options: BackfillOptions = {},
  ): Promise<number> {
    if (!this.jobs || !this.games) {
      throw new Error(
        'ensureSummariesForRows needs jobs and games repositories; they were not provided.',
      );
    }
    const ids = [...new Set(gameIds)];
    let created = 0;
    for (const gameId of ids) {
      if (options.signal?.aborted) {
        break;
      }
      const jobs = await this.jobs.listByGame(gameId);
      const latest = latestCompletedJob(jobs);
      if (!latest) {
        continue;
      }
      const existing = await this.summaries.getForAnalysis(latest.id);
      if (existing) {
        continue;
      }
      const game = await this.games.getGame(gameId);
      if (!game) {
        continue;
      }
      const records = await this.analyses.listForGameAndAnalysis(gameId, latest.id);
      if (records.length === 0) {
        continue;
      }
      const built = buildAnalysisSummary(records, game.userColor, { detectionState: 'absent' });
      await this.summaries.putForAnalysis({
        analysisId: latest.id,
        gameId,
        userColor: game.userColor,
        updatedAt: this.now(),
        ...built,
      });
      created += 1;
    }
    return created;
  }

  /**
   * Explicit teardown: dispose the injected engine service (the dedicated
   * verification engine, ADR-034). Used by the analysis-service teardown; the
   * idle-disposing lazy wrapper also calls its inner service's `dispose`.
   * Idempotent because `EngineService.dispose` is.
   */
  async dispose(): Promise<void> {
    await this.engine.dispose();
  }

  // --- internals --------------------------------------------------------------

  /** Persist the run's records with the verified-miss annotations applied. */
  private async persistAnnotatedRecords(
    records: readonly MoveAnalysis[],
    verified: readonly VerifiedTacticalCandidate[],
  ): Promise<void> {
    if (verified.length === 0) {
      return;
    }
    const annotated = annotateVerifiedMisses(records, verified, DETECTION_VERSION);
    await this.analyses.replaceAnalysis(annotated);
  }

  /** Persist one per-analysis summary row for the pass state + optional extras. */
  private async writeSummary(
    job: AnalysisJob,
    game: { readonly id: string; readonly userColor: Color },
    records: readonly MoveAnalysis[],
    state: SummaryDetectionState,
    extras: {
      readonly missedTacticCount?: number | null;
      readonly detectionVersion?: number | null;
      readonly scanProgress?: ScanProgress | null;
      readonly verificationDepth?: number | null;
    } = {},
    options: { readonly carryPuzzleFields?: boolean } = {},
  ): Promise<void> {
    const summaryOptions: BuildAnalysisSummaryOptions =
      state === 'completed'
        ? {
            detectionState: state,
            ...(extras.verificationDepth !== undefined
              ? { verificationDepth: extras.verificationDepth }
              : {}),
            ...(extras.missedTacticCount !== undefined
              ? { missedTacticCount: extras.missedTacticCount }
              : {}),
            ...(extras.detectionVersion !== undefined
              ? { detectionVersion: extras.detectionVersion }
              : {}),
            ...(extras.scanProgress !== undefined ? { scanProgress: extras.scanProgress } : {}),
          }
        : {
            detectionState: state,
            ...(extras.verificationDepth !== undefined
              ? { verificationDepth: extras.verificationDepth }
              : {}),
            ...(extras.scanProgress !== undefined ? { scanProgress: extras.scanProgress } : {}),
          };
    const built = buildAnalysisSummary(records, game.userColor, summaryOptions);
    // Feature-011 coexistence (plan R-2): the full-row rebuild from
    // `buildAnalysisSummary` defaults the puzzle-generation fields to absent,
    // which would clobber them on every write. The pass explicitly resets them
    // only when it STARTS a fresh (re)derivation (the empty-pass / first
    // `inProgress` writes below pass `carryPuzzleFields: false`); every later
    // write in the same pass carries the current row's puzzle fields through
    // (read-modify-write), so the two state machines can only ever overlap —
    // during a detection refresh of an already-generated analysis — with a
    // deterministic reset.
    let existing: AnalysisSummaryRow | undefined;
    if (options.carryPuzzleFields !== false) {
      existing = await this.summaries.getForAnalysis(job.id);
    }
    const row: AnalysisSummaryRow = {
      analysisId: job.id,
      gameId: game.id,
      userColor: game.userColor,
      updatedAt: this.now(),
      ...built,
      ...(existing?.puzzleState !== undefined ? { puzzleState: existing.puzzleState } : {}),
      ...(existing?.puzzleProgress !== undefined
        ? { puzzleProgress: existing.puzzleProgress }
        : {}),
      ...(existing?.puzzleGeneratorVersion !== undefined
        ? { puzzleGeneratorVersion: existing.puzzleGeneratorVersion }
        : {}),
    };
    await this.summaries.putForAnalysis(row);
  }

  /**
   * Persist the current scan progress (plan 013 W3) into an `inProgress`
   * summary. Called after each candidate settles so a live scan's bar advances;
   * also used mid-pass where the state stays `inProgress`.
   */
  private async persistScanProgress(
    job: AnalysisJob,
    game: { readonly id: string; readonly userColor: Color },
    records: readonly MoveAnalysis[],
    done: number,
    total: number,
    verificationDepth: number,
  ): Promise<void> {
    await this.writeSummary(job, game, records, 'inProgress', {
      scanProgress: { done, total },
      verificationDepth,
    });
  }

  private resolveEngineIdentity(job: AnalysisJob): EngineIdentity {
    const status = this.engine.getStatus();
    if (status.engine) {
      return status.engine;
    }
    return {
      engineName: job.engine.engineName,
      engineVersion: job.engine.engineVersion,
      engineBuild: job.engine.engineBuild,
    };
  }

  /**
   * WP-C fast-path: verify one candidate from its position's stored analysis
   * when the stored record is a complete, decisive mate line produced by the
   * same engine (name/version/build) — the candidate records that engine's
   * provenance. Returns `null` (engine fallback) otherwise.
   */
  private fastPathCandidate(
    candidate: RawCandidate,
    engineIdentity: EngineIdentity,
    record: MoveAnalysis | undefined,
  ): VerifiedTacticalCandidate | null {
    if (!record) {
      return null;
    }
    const engine = record.engine;
    if (!engine) {
      return null;
    }
    // Self-guard: the stored row must be the analysis of exactly the position
    // the candidate wants to verify (the ply-keyed lookup implies it today).
    if (record.positionFen !== candidate.startingFen) {
      return null;
    }
    if (
      engine.engineName !== engineIdentity.engineName ||
      engine.engineVersion !== engineIdentity.engineVersion ||
      engine.engineBuild !== engineIdentity.engineBuild
    ) {
      return null;
    }
    return fastPathVerifiedCandidate(
      candidate,
      {
        engine: {
          engineName: engine.engineName,
          engineVersion: engine.engineVersion,
          engineBuild: engine.engineBuild,
        },
        depth: record.depth ?? 0,
        evalMate: 'mate' in record.evalBefore ? record.evalBefore.mate : null,
        bestPv: record.bestPv,
        analysisVersion: record.analysisVersion,
      },
      this.now(),
    );
  }

  /**
   * One candidate's Stage-2 verification: ADR-018 cache lookup first, else a
   * `tactical`-profile engine run (off the UI thread), then the pure
   * `verifyCandidate` verdict. An aborted signal during the engine search
   * cancels the job and reports `aborted`; a failed/cancelled/throw engine job
   * reports `engine-failed` (retried/deferred by the caller).
   *
   * The cache scope is the ADR-018 tactical scope plus the effective
   * verification depth, the fixed verification thread count (`1`, ADR-034) and
   * the `VERIFY_MOVETIME_MS` backstop (ADR-018 §"Tactical-detection
   * verification scope"), so a result produced at one depth is never served to
   * a search at another. The Game-analysis run's `threads` override is
   * deliberately **not** inherited: the dedicated verification engine uses its
   * own conservative count.
   */
  private async verifyCandidateWithEngine(
    candidate: RawCandidate,
    engineIdentity: EngineIdentity,
    verificationDepth: number,
    signal?: AbortSignal,
  ): Promise<VerificationOutcome> {
    const scope = {
      profile: 'tactical' as const,
      maxDepth: verificationDepth,
      movetimeMs: VERIFY_MOVETIME_MS,
      threads: VERIFICATION_THREADS,
    };
    const key = analysisCacheKey(candidate.startingFen, scope, engineIdentity);
    if (this.engineCache) {
      const cached = await this.engineCache.get(key);
      if (cached) {
        return this.toVerdict(cached, candidate, engineIdentity, verificationDepth);
      }
    }
    if (signal?.aborted) {
      return { kind: 'aborted' };
    }

    let result: EngineAnalysisResult;
    try {
      const handle = this.engine.analyze(candidate.startingFen, {
        profile: 'tactical',
        // The user's effective verification depth; VERIFY_MOVETIME_MS
        // backstops it so a pathological position can never hold the search
        // open past the bound (plan-013 fix C). The engine stops at whichever
        // limit it reaches first.
        maxDepth: verificationDepth,
        movetimeMs: VERIFY_MOVETIME_MS,
        threads: VERIFICATION_THREADS,
      });
      const settled = await Promise.race([handle.outcome, abortSignal(signal)]);
      if (settled === 'aborted') {
        handle.cancel();
        return { kind: 'aborted' };
      }
      if (settled.kind === 'cancelled') {
        return { kind: 'engine-failed', message: 'Engine job was cancelled.' };
      }
      if (settled.kind === 'failed') {
        return { kind: 'engine-failed', message: settled.error.message };
      }
      result = settled.result;
    } catch (err) {
      return {
        kind: 'engine-failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (this.engineCache) {
      const putKey = analysisCacheKey(
        candidate.startingFen,
        {
          profile: result.profile,
          maxDepth: verificationDepth,
          movetimeMs: VERIFY_MOVETIME_MS,
          threads: VERIFICATION_THREADS,
        },
        result.engine,
      );
      try {
        await this.engineCache.put(putKey, result);
      } catch {
        // A cache write failure never fails the pass; the result is still used.
      }
    }
    return this.toVerdict(result, candidate, engineIdentity, verificationDepth);
  }

  private toVerdict(
    result: EngineAnalysisResult,
    candidate: RawCandidate,
    engineIdentity: EngineIdentity,
    verificationDepth: number,
  ): VerificationOutcome {
    const lines: readonly TacticalCandidateLine[] = result.lines.map((line) =>
      toTacticalCandidateLine(line),
    );
    const verdict = verifyCandidate({
      candidate,
      now: this.now(),
      verificationDepth,
      engine: engineIdentity,
      lines,
    });
    if (verdict.ok) {
      return { kind: 'verified', candidate: verdict.candidate };
    }
    const top = result.lines[0];
    return {
      kind: 'rejected',
      reason: verdict.reason,
      ...(top !== undefined ? { line: toCandidateVerificationLine(top) } : {}),
    };
  }
}

/** The engine's top line of a rejected verdict, for the scan report. */
function toCandidateVerificationLine(line: EngineLine): CandidateVerificationLine {
  const evaluation = line.evaluation;
  return {
    move: line.principalVariation[0]?.uci ?? '',
    uci: line.principalVariation.map((move) => move.uci),
    evalCp: 'cp' in evaluation ? evaluation.cp : null,
    evalMate: 'mate' in evaluation ? evaluation.mate : null,
  };
}

/** Map an engine line onto the engine-free Stage-2 verification input. */
function toTacticalCandidateLine(line: EngineLine): TacticalCandidateLine {
  const evaluation = line.evaluation;
  return {
    multipv: line.multipv,
    evalCp: 'cp' in evaluation ? evaluation.cp : null,
    evalMate: 'mate' in evaluation ? evaluation.mate : null,
    wdl: line.wdl,
    uci: line.principalVariation.map((move) => move.uci),
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
