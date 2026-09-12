/**
 * Puzzle-generation orchestration service (Feature 011, Stage C).
 *
 * Turns a completed analysis run's verified tactical candidates (Feature 010)
 * **plus** its qualifying user-side blunder plies into durable, immutable,
 * game-scoped `PuzzleRow` rows (`src/domain/puzzle`), coordinating the pure
 * assembly with the Feature-011 persistence (per-analysis summaries, the
 * schema-v8 `puzzles` table):
 *
 * 1. Freshness gate: the pass runs only when the per-analysis summary reports a
 *    detection verdict `completed` by the **current** `DETECTION_VERSION` — the
 *    mirror of the scanGame freshness check (analysisService.ts). Any other
 *    state leaves the puzzle-generation fields `absent` (the Library renders the
 *    Feature-010 note, never a zero).
 * 2. Inputs, in deterministic order:
 *    - the analysis's `verified` candidates (current detection version only,
 *      ordered by `sourcePly`) are assembled one-by-one with `assemblePuzzle`
 *      (pure, no engine, no difficulty recompute);
 *    - then the qualifying user-side blunder plies of the same analysis (a
 *      `MoveAnalysis` whose `side` is the user's colour, whose ADR-023
 *      `classification` is `'blunder'`, and which is **not** owned by a
 *      current-version verified candidate, ordered by `ply`) are assembled
 *      one-by-one with `assembleBlunderPuzzle` (pure, no engine) into one-move
 *      "correct-move" puzzles.
 *    A ply that is BOTH a current-version verified tactical candidate and a
 *    user blunder is excluded from the blunder input set (ADR-023 exclusivity),
 *    so it yields exactly one — the richer tactical — puzzle and settles once.
 *    Rows are written through the repository's idempotent `addIfAbsent` on the
 *    natural key `[sourceGameId + sourcePly]` — first write wins, re-analysis /
 *    resume / retry / regeneration never duplicates or overwrites an immutable
 *    row.
 * 3. The per-analysis summary is kept in sync through the generation-pass state
 *    machine (`absent → queued → inProgress → completed | failed`), always via
 *    `summaries.patchForAnalysis` on the puzzle fields **only**, so detection
 *    fields and classification counts are never clobbered (plan R-2).
 *
 * A completed pass is final only for the generator version it ran under: the
 * idempotency gate no-ops solely when the summary reports `completed` **and**
 * `puzzleGeneratorVersion === PUZZLE_GENERATOR_VERSION`. A completed pass from
 * an older generator is *outdated* and is re-run by any pass invocation —
 * regeneration is engine-free and identical to the original pass (same stored
 * inputs, same assembly, same add-only writes), which is what adds the
 * one-move blunder correct-move rows an older pass never produced. Existing
 * immutable rows are never overwritten or deleted; the completed write records
 * the current generator version.
 *
 * An empty input set is a real zero: the pass completes with
 * `puzzleState: 'completed'`, `puzzleProgress: {done: 0, total: 0}` and the
 * generator version — never `absent`. Progress counts **items settled** (a
 * candidate and a distinct blunder ply each count once; a candidate-owned ply
 * is not a blunder input, so a missed tactic settles once — exactly like a
 * resumed pass counts an already-persisted row), so `done` may exceed the row
 * count when a row already existed; the Library count is always the live
 * `puzzles` row count. An aborted pass (caller `AbortSignal`) stops at the next
 * item boundary, leaves already-written rows persisted and the summary
 * resumable at `queued`; the next invocation re-runs the pass and the natural
 * key skips the already-persisted rows. A write/assembly error flips the
 * summary to `failed` (already-written rows persist) and is contained — the
 * pass never throws to a detached caller, mirroring the detection service's
 * failure semantics.
 *
 * Engine-free by construction: no `EngineService`, no ADR-018 cache import and
 * no candidate generation — Feature-011 consumes the verified-candidate rows
 * and the analysis's stored per-ply records only (spec "Pipeline boundary").
 * The pass is bounded by the `MAX_CANDIDATES_PER_GAME` Stage-1 cap plus the
 * analysis's user-blunder plies.
 */

import type { Color } from 'chessops/types';
import type { MoveAnalysis } from '@/domain/chess';
import {
  assembleBlunderPuzzle,
  assemblePuzzle,
  PUZZLE_GENERATOR_VERSION,
  type BlunderPuzzleInput,
} from '@/domain/puzzle';
import type { PuzzleGenerationState } from '@/domain/puzzle';
import type { ScanProgress } from '@/domain/analysis/summaryDerivation';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import type { AnalysisRepository } from '@/infrastructure/db/analysis-repository';
import type { AnalysisSummariesRepository } from '@/infrastructure/db/summaries-repository';
import type { PuzzleCandidatesRepository } from '@/infrastructure/db/candidates-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';

export interface PuzzleGenerationServiceOptions {
  /** Feature-011 immutable puzzle rows (`addIfAbsent` is the only write path). */
  readonly puzzles: PuzzlesRepository;
  /** Feature-010 verified-candidate rows (one of this pass's two inputs). */
  readonly candidates: PuzzleCandidatesRepository;
  /**
   * The analysis's stored per-ply `MoveAnalysis` records — the source of the
   * pass's second input: user-side plies classified `blunder` (ADR-023) that
   * Feature-010 did not verify become one-move correct-move puzzles.
   */
  readonly analyses: AnalysisRepository;
  /** Per-analysis summaries (the shared generation-state holder). */
  readonly summaries: AnalysisSummariesRepository;
  /** Puzzle creation timestamp (Unix epoch millis); defaults to `Date.now`. */
  readonly now?: () => number;
}

export class PuzzleGenerationService {
  private readonly puzzles: PuzzlesRepository;
  private readonly candidates: PuzzleCandidatesRepository;
  private readonly analyses: AnalysisRepository;
  private readonly summaries: AnalysisSummariesRepository;
  private readonly now: () => number;

  constructor(options: PuzzleGenerationServiceOptions) {
    this.puzzles = options.puzzles;
    this.candidates = options.candidates;
    this.analyses = options.analyses;
    this.summaries = options.summaries;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Run the generation pass for one completed analysis identity: persist every
   * verified candidate of the current detection version and every qualifying
   * user-side blunder ply as immutable puzzle rows and drive the summary's
   * puzzle-generation state to `completed` (or `failed`/`queued`, see the
   * module header). Idempotent per analysis identity and abort-aware/resumable:
   * already-persisted `(sourceGameId, sourcePly)` rows are skipped by the
   * natural key on a resume. A completed pass is a no-op only when it is at
   * the current `PUZZLE_GENERATOR_VERSION`; a completed pass from an older
   * generator is regenerated (see the idempotency gate below).
   */
  async runPassForAnalysis(
    analysisId: string,
    game: { readonly id: string; readonly userColor: Color },
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      return;
    }
    const summary = await this.summaries.getForAnalysis(analysisId);
    // Idempotency gate: a completed generation pass is final ONLY for the
    // generator version it ran under. A pass that is `completed` at the
    // current PUZZLE_GENERATOR_VERSION is a no-op (rows are add-only, so a
    // later pass over new inputs only ever adds absent keys). A completed pass
    // from an older generator is *outdated* — this invocation regenerates it
    // (the engine-free re-run adds the rows the newer generator produces,
    // e.g. one-move blunder correct-move puzzles, and never touches existing
    // immutable rows). A pass in any other state (absent/queued/inProgress/
    // failed) also runs, exactly as a normal pass/resume/retry.
    if (!summary) {
      return;
    }
    if (
      summary.puzzleState === 'completed' &&
      summary.puzzleGeneratorVersion === PUZZLE_GENERATOR_VERSION
    ) {
      return;
    }
    // Freshness precondition: only generate off a detection verdict produced by
    // the current DETECTION_VERSION. Detection absent/queued/inProgress/failed —
    // or a stale completed verdict — leaves the puzzle fields `absent` and does
    // nothing (the Library renders the Feature-010 note until detection is
    // fresh again).
    if (summary.detectionState !== 'completed' || summary.detectionVersion !== DETECTION_VERSION) {
      return;
    }

    let done = 0;
    let total = 0;
    try {
      const candidateRows = await this.candidates.listForGameAndAnalysis(game.id, analysisId);
      const verified = candidateRows.filter(
        (row): row is VerifiedTacticalCandidate =>
          row.verificationStatus === 'verified' && row.detectionVersion === DETECTION_VERSION,
      );
      const records = await this.analyses.listForGameAndAnalysis(game.id, analysisId);
      // ADR-023 exclusivity: a ply owned by a current-version verified candidate
      // is not a blunder input — the tactical row is the one puzzle it yields,
      // so the pass settles the ply once. A stale candidate is not in this set,
      // so its ply falls through to the blunder origin.
      const candidateOwned = new Set(
        verified.map((candidate) => `${candidate.analysisId}:${candidate.sourcePly}`),
      );
      const blunders = qualifyingUserBlunders(
        records,
        game.userColor,
        DETECTION_VERSION,
        candidateOwned,
      );
      total = verified.length + blunders.length;
      // An empty input set is a real "no puzzles generated by this analysis"
      // result — completed with zero rows, never absent.
      if (total === 0) {
        await this.writeState(analysisId, 'completed', { done: 0, total: 0 });
        return;
      }
      await this.writeState(analysisId, 'inProgress', { done: 0, total });
      // Verified candidates first, then blunder plies: a ply that is both keeps
      // the richer tactical row (the blunder is skipped by addIfAbsent).
      for (const candidate of verified) {
        if (signal?.aborted) {
          await this.writeState(analysisId, 'queued', { done, total });
          return;
        }
        const row = assemblePuzzle(candidate, this.now());
        await this.puzzles.addIfAbsent([row]);
        done += 1;
        await this.writeState(analysisId, 'inProgress', { done, total });
      }
      for (const blunder of blunders) {
        if (signal?.aborted) {
          await this.writeState(analysisId, 'queued', { done, total });
          return;
        }
        const row = assembleBlunderPuzzle(blunder, this.now());
        await this.puzzles.addIfAbsent([row]);
        done += 1;
        await this.writeState(analysisId, 'inProgress', { done, total });
      }
      if (signal?.aborted) {
        await this.writeState(analysisId, 'queued', { done, total });
        return;
      }
      await this.writeState(analysisId, 'completed', { done, total });
    } catch (err) {
      // A write/assembly error interrupts the pass: already-written rows
      // persist (add-only) and the summary flips to `failed` with the current
      // progress so the next invocation retries only the missing rows. The
      // error is contained (never thrown to a detached caller) — unless even
      // the failure write fails, in which case it must surface.
      try {
        await this.writeState(analysisId, 'failed', { done, total });
      } catch {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  /**
   * Patch one puzzle-generation state + progress into the analysis's summary,
   * touching the puzzle fields **only** (a `completed` state also records the
   * generator version). A silent no-op when the summary row no longer exists.
   */
  private async writeState(
    analysisId: string,
    state: PuzzleGenerationState,
    progress: ScanProgress,
  ): Promise<void> {
    await this.summaries.patchForAnalysis(analysisId, {
      puzzleState: state,
      puzzleProgress: progress,
      ...(state === 'completed' ? { puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION } : {}),
    });
  }
}

/**
 * The pass's second input: every user-side ply of the analysis whose
 * ADR-023 classification is `'blunder'` (Feature 009), in `ply` order. A ply
 * owned by a **current-version verified candidate** (`candidateOwned`, keyed
 * `analysisId:sourcePly`) is excluded — it is a missed tactic and yields the
 * richer tactical row only (ADR-023 exclusivity), so the pass settles it once.
 * A stale candidate is not in `candidateOwned`, so its ply still falls through
 * to this origin. A ply with no engine `bestMove` has no "move you should have
 * played" to derive and is dropped (the position may be a book/terminal gap);
 * an unparseable starting FEN is a pipeline defect that assembly rejects loudly
 * (the pass flips `failed`, mirroring `assemblePuzzle`).
 */
function qualifyingUserBlunders(
  records: readonly MoveAnalysis[],
  userColor: Color,
  detectionVersion: number,
  candidateOwned: ReadonlySet<string>,
): BlunderPuzzleInput[] {
  const inputs: BlunderPuzzleInput[] = [];
  for (const record of records) {
    if (record.side !== userColor || record.classification !== 'blunder') {
      continue;
    }
    if (candidateOwned.has(`${record.analysisId}:${record.ply}`)) {
      continue;
    }
    const bestMove = record.bestMove;
    if (!bestMove) {
      // No engine top choice for this ply — there is no "move you should have
      // played" to derive; skip (the position may be a book/terminal gap).
      continue;
    }
    inputs.push({
      sourceGameId: record.gameId,
      sourcePly: record.ply,
      analysisId: record.analysisId,
      startingFen: record.positionFen,
      userMovePlayed: record.playedMove.uci,
      bestMove: bestMove.uci,
      evalBefore: record.evalBefore,
      evalAfter: record.evalAfter,
      detectionVersion,
    });
  }
  return inputs;
}
