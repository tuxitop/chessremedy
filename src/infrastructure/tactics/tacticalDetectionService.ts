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
  clearMissedTacticAnnotations,
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
import { profileConfig } from '@/infrastructure/engine/engineProfiles';
import type { EngineLine } from '@/infrastructure/engine/types';
import type { EngineAnalysisResult, EngineService } from '@/infrastructure/engine/types';

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
  private readonly tacticalDepth: number;

  constructor(options: TacticalDetectionServiceOptions) {
    this.engine = options.engine;
    this.engineCache = options.engineCache ?? null;
    this.analyses = options.analyses;
    this.candidates = options.candidates;
    this.summaries = options.summaries;
    this.jobs = options.jobs ?? null;
    this.games = options.games ?? null;
    this.now = options.now ?? (() => Date.now());
    this.tacticalDepth = profileConfig('tactical').depth;
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
    if (
      existing?.detectionState === 'completed' &&
      existing.detectionVersion === DETECTION_VERSION
    ) {
      return;
    }
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
    // go.
    const storedRows = await this.candidates.listForGameAndAnalysis(game.id, job.id);
    let stored: readonly PuzzleCandidateRow[] = storedRows;
    const hasStaleRows = storedRows.some(
      (row) => row.verificationStatus === 'verified' && row.detectionVersion !== DETECTION_VERSION,
    );
    const hasStaleCompleted =
      existing?.detectionState === 'completed' && existing.detectionVersion !== DETECTION_VERSION;
    const hasStaleAnnotations = records.some(
      (record) => record.missedTactic && record.detectionVersion !== DETECTION_VERSION,
    );
    if (hasStaleCompleted || hasStaleRows || hasStaleAnnotations) {
      await this.candidates.deleteForAnalysis(job.id);
      const cleared = clearMissedTacticAnnotations(records, DETECTION_VERSION);
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
      await this.writeSummary(job, game, records, 'completed', {
        missedTacticCount: 0,
        detectionVersion: DETECTION_VERSION,
        scanProgress: { done: 0, total: 0 },
      });
      return;
    }
    if (signal?.aborted) {
      return;
    }

    // Resumability: candidates that already carry a `verified` row written by
    // the **current** detection version (an earlier, interrupted or failed pass)
    // are reused without an engine run; every other candidate is (re)persisted
    // as `raw` BEFORE Stage 2 so an interruption never loses the candidate set.
    // Rows from older versions are wiped above and filtered here as a defensive
    // backstop.
    const verifiedByPly = new Map<number, VerifiedTacticalCandidate>();
    for (const row of stored) {
      if (row.verificationStatus === 'verified' && row.detectionVersion === DETECTION_VERSION) {
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
    await this.writeSummary(job, game, records, 'inProgress', {
      scanProgress: { done: settledCount, total },
    });

    const engineIdentity = this.resolveEngineIdentity(job);
    // A completed run's Game-analysis settings (job.config) may carry a threads
    // override; the scan's tactical searches belong to that run's identity, so
    // they apply the same override (and cache scope). Dropped when 1 (default).
    const threads =
      job.config?.threads !== undefined && job.config.threads > 1 ? job.config.threads : undefined;
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
          await this.persistScanProgress(job, game, records, settledCount, total);
          await this.persistAnnotatedRecords(records, verified);
          continue;
        }
      }

      const outcome = await this.verifyCandidateWithEngine(
        candidate,
        engineIdentity,
        signal,
        threads,
      );
      if (outcome.kind === 'aborted') {
        await this.writeSummary(job, game, records, 'queued', {
          scanProgress: { done: settledCount, total },
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
            });
            return;
          }
          settled = await this.verifyCandidateWithEngine(
            candidate,
            engineIdentity,
            signal,
            threads,
          );
          if (settled.kind === 'aborted') {
            await this.writeSummary(job, game, records, 'queued', {
              scanProgress: { done: settledCount, total },
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
          await this.persistScanProgress(job, game, records, settledCount, total);
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
        await this.persistScanProgress(job, game, records, settledCount, total);
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
        await this.persistScanProgress(job, game, records, settledCount, total);
        continue;
      }
      await this.candidates.bulkPutForAnalysis([outcome.candidate]);
      verified.push(outcome.candidate);
      settledCount += 1;
      await this.persistScanProgress(job, game, records, settledCount, total);
      await this.persistAnnotatedRecords(records, verified);
    }

    if (signal?.aborted) {
      await this.writeSummary(job, game, records, 'queued', {
        scanProgress: { done: settledCount, total },
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
      });
      return;
    }
    await this.writeSummary(job, game, records, 'completed', {
      missedTacticCount: verified.length,
      detectionVersion: DETECTION_VERSION,
      scanProgress: { done: total, total },
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
    } = {},
  ): Promise<void> {
    const options: BuildAnalysisSummaryOptions =
      state === 'completed'
        ? {
            detectionState: state,
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
            ...(extras.scanProgress !== undefined ? { scanProgress: extras.scanProgress } : {}),
          };
    const built = buildAnalysisSummary(records, game.userColor, options);
    const row: AnalysisSummaryRow = {
      analysisId: job.id,
      gameId: game.id,
      userColor: game.userColor,
      updatedAt: this.now(),
      ...built,
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
  ): Promise<void> {
    await this.writeSummary(job, game, records, 'inProgress', {
      scanProgress: { done, total },
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
   * reports `engine-failed` (retried/deferred by the caller). `threads` is the
   * run's optional threads override (dropped when undefined/1). The tactical
   * search is bounded by `VERIFY_MOVETIME_MS` (plan-013 fix C), which is part
   * of the ADR-018 cache scope so time-capped results stay distinguishable.
   */
  private async verifyCandidateWithEngine(
    candidate: RawCandidate,
    engineIdentity: EngineIdentity,
    signal?: AbortSignal,
    threads?: number,
  ): Promise<VerificationOutcome> {
    const scope = {
      profile: 'tactical' as const,
      movetimeMs: VERIFY_MOVETIME_MS,
      ...(threads !== undefined && threads > 1 ? { threads } : {}),
    };
    const key = analysisCacheKey(candidate.startingFen, scope, engineIdentity);
    if (this.engineCache) {
      const cached = await this.engineCache.get(key);
      if (cached) {
        return this.toVerdict(cached, candidate, engineIdentity);
      }
    }
    if (signal?.aborted) {
      return { kind: 'aborted' };
    }

    let result: EngineAnalysisResult;
    try {
      const handle = this.engine.analyze(candidate.startingFen, {
        profile: 'tactical',
        // Depth stays the ADR-012 tactical depth; VERIFY_MOVETIME_MS backstops
        // it so a pathological position can never hold the search open past
        // the bound (plan-013 fix C). The depth is also passed explicitly so
        // the engine stops at whichever limit it reaches first.
        maxDepth: this.tacticalDepth,
        movetimeMs: VERIFY_MOVETIME_MS,
        ...(threads !== undefined && threads > 1 ? { threads } : {}),
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
          movetimeMs: VERIFY_MOVETIME_MS,
          ...(threads !== undefined && threads > 1 ? { threads } : {}),
        },
        result.engine,
      );
      try {
        await this.engineCache.put(putKey, result);
      } catch {
        // A cache write failure never fails the pass; the result is still used.
      }
    }
    return this.toVerdict(result, candidate, engineIdentity);
  }

  private toVerdict(
    result: EngineAnalysisResult,
    candidate: RawCandidate,
    engineIdentity: EngineIdentity,
  ): VerificationOutcome {
    const lines: readonly TacticalCandidateLine[] = result.lines.map((line) =>
      toTacticalCandidateLine(line),
    );
    const verdict = verifyCandidate({
      candidate,
      now: this.now(),
      verificationDepth: this.tacticalDepth,
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
