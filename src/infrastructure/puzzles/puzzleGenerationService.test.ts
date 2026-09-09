/**
 * PuzzleGenerationService tests (Feature 011, Stage C).
 *
 * Engine-free orchestration tests over in-memory fake repositories (no Dexie,
 * no engine, no network): the pass state machine, the freshness/idempotency
 * gates, real-zero completion, per-candidate assembly + idempotent persistence
 * (natural key `[sourceGameId, sourcePly]`), resume-after-abort (only the
 * missing rows are written), and the failure path. Verified candidates come
 * from the deterministic `src/domain/puzzle` fixtures, re-scoped to one game +
 * analysis identity.
 */

import { describe, expect, it } from 'vitest';
import type { Color } from 'chessops/types';
import {
  assembleBlunderPuzzle,
  assemblePuzzle,
  blunderDifficultyOf,
  PUZZLE_GENERATOR_VERSION,
} from '@/domain/puzzle';
import type { PuzzleRow } from '@/domain/puzzle';
import { puzzleFixture } from '@/domain/puzzle/test-support';
import { makeMove } from '@/domain/analysis/test-support';
import type { MoveAnalysis } from '@/domain/chess';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { RawCandidate, VerifiedTacticalCandidate } from '@/domain/tactics';
import type { AnalysisSummaryRow } from '@/infrastructure/db/summaries-repository';
import type { PuzzleCandidateRow } from '@/infrastructure/db/candidates-repository';
import {
  PuzzleGenerationService,
  type PuzzleGenerationServiceOptions,
} from './puzzleGenerationService';

const NOW = 1_700_000_000_000;
const GAME_ID = 'game:generation';
const ANALYSIS_ID = 'analysis:generation';

type SummaryRow = AnalysisSummaryRow;

function baseSummaryRow(analysisId: string, gameId: string, now: number): SummaryRow {
  return {
    analysisId,
    gameId,
    userColor: 'white',
    classificationCounts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    userMoves: 0,
    totalMoves: 0,
    accuracy: null,
    accuracyMoves: 0,
    detectionState: 'completed',
    missedTacticCount: 0,
    detectionVersion: DETECTION_VERSION,
    updatedAt: now,
  };
}

/**
 * In-memory summaries fake (partial `AnalysisSummariesRepository`): full-row
 * put, partial patch, read back. Patches are logged for state-machine asserts.
 */
class FakeSummariesRepository {
  readonly rows = new Map<string, SummaryRow>();
  private readonly applied: Array<Partial<SummaryRow>> = [];

  get patches(): ReadonlyArray<Partial<SummaryRow>> {
    return this.applied;
  }

  putForAnalysis(summary: SummaryRow): Promise<void> {
    this.rows.set(summary.analysisId, summary);
    return Promise.resolve();
  }

  patchForAnalysis(analysisId: string, patch: Partial<SummaryRow>): Promise<void> {
    const existing = this.rows.get(analysisId);
    if (!existing) {
      return Promise.resolve();
    }
    this.rows.set(analysisId, {
      ...existing,
      ...patch,
      analysisId,
      updatedAt: existing.updatedAt + 1,
    });
    this.applied.push(patch);
    return Promise.resolve();
  }

  getForAnalysis(analysisId: string): Promise<SummaryRow | undefined> {
    return Promise.resolve(this.rows.get(analysisId));
  }
}

/** In-memory candidates fake (partial `PuzzleCandidatesRepository`). */
class FakeCandidatesRepository {
  private readonly rows = new Map<string, PuzzleCandidateRow>();

  constructor(rows: readonly PuzzleCandidateRow[] = []) {
    for (const row of rows) {
      this.rows.set(`${row.analysisId}:${row.sourcePly}`, row);
    }
  }

  listForGameAndAnalysis(
    gameId: string,
    analysisId: string,
  ): Promise<readonly PuzzleCandidateRow[]> {
    const rows = [...this.rows.values()]
      .filter((row) => row.sourceGameId === gameId && row.analysisId === analysisId)
      .sort((a, b) => a.sourcePly - b.sourcePly);
    return Promise.resolve(rows);
  }
}

/** In-memory per-ply analyses fake (partial `AnalysisRepository`). */
class FakeAnalysesRepository {
  private readonly rows = new Map<string, MoveAnalysis>();

  constructor(rows: readonly MoveAnalysis[] = []) {
    for (const row of rows) {
      this.rows.set(`${row.analysisId}:${row.ply}`, row);
    }
  }

  listForGameAndAnalysis(gameId: string, analysisId: string): Promise<readonly MoveAnalysis[]> {
    const rows = [...this.rows.values()]
      .filter((row) => row.gameId === gameId && row.analysisId === analysisId)
      .sort((a, b) => a.ply - b.ply);
    return Promise.resolve(rows);
  }
}

/** In-memory puzzles fake (partial `PuzzlesRepository`) with per-add hooks. */
class FakePuzzlesRepository {
  private readonly rows = new Map<string, PuzzleRow>();
  /** Fired before each `addIfAbsent` write (used to abort mid-pass). */
  onBeforeAdd?: ((rows: readonly PuzzleRow[]) => void) | undefined;
  /** When set, the next `addIfAbsent` throws (failure path). */
  failNextAdd = false;
  addCalls = 0;

  addIfAbsent(rows: readonly PuzzleRow[]): Promise<number> {
    if (this.failNextAdd) {
      this.failNextAdd = false;
      return Promise.reject(new Error('puzzle write failed'));
    }
    this.onBeforeAdd?.(rows);
    this.addCalls += 1;
    let added = 0;
    for (const row of rows) {
      const key = `${row.sourceGameId}:${row.sourcePly}`;
      if (!this.rows.has(key)) {
        this.rows.set(key, row);
        added += 1;
      }
    }
    return Promise.resolve(added);
  }

  listForGame(gameId: string): Promise<PuzzleRow[]> {
    const rows = [...this.rows.values()]
      .filter((row) => row.sourceGameId === gameId)
      .sort((a, b) => a.sourcePly - b.sourcePly);
    return Promise.resolve(rows);
  }

  countForGame(gameId: string): Promise<number> {
    const count = [...this.rows.values()].filter((row) => row.sourceGameId === gameId).length;
    return Promise.resolve(count);
  }
}

interface Rig {
  readonly summaries: FakeSummariesRepository;
  readonly candidates: FakeCandidatesRepository;
  readonly analyses: FakeAnalysesRepository;
  readonly puzzles: FakePuzzlesRepository;
  readonly service: PuzzleGenerationService;
  /** The current-version verified candidates of the rig, in sourcePly order. */
  readonly verified: readonly VerifiedTacticalCandidate[];
}

function rig(
  candidates: readonly PuzzleCandidateRow[],
  summaries: FakeSummariesRepository,
  records: readonly MoveAnalysis[] = [],
): Rig {
  const repo = new FakeCandidatesRepository(candidates);
  const analyses = new FakeAnalysesRepository(records);
  const puzzles = new FakePuzzlesRepository();
  const options = {
    puzzles,
    candidates: repo,
    analyses,
    summaries,
    now: () => NOW,
  } as unknown as PuzzleGenerationServiceOptions;
  const service = new PuzzleGenerationService(options);
  const verified = candidates.filter(
    (row): row is VerifiedTacticalCandidate =>
      row.verificationStatus === 'verified' && row.detectionVersion === DETECTION_VERSION,
  );
  return { summaries, candidates: repo, analyses, puzzles, service, verified };
}

/** A fixture candidate re-scoped to this suite's game + analysis identity. */
function scoped(kind: Parameters<typeof puzzleFixture>[0]): VerifiedTacticalCandidate {
  return {
    ...puzzleFixture(kind),
    sourceGameId: GAME_ID,
    analysisId: ANALYSIS_ID,
  };
}

/** The three current-version verified candidates (sourcePly 6, 8, 20). */
function verifiedCandidates(): readonly VerifiedTacticalCandidate[] {
  return [scoped('mate-one'), scoped('material-combination'), scoped('accepted-alternatives')];
}

/** A verified candidate written by an older DETECTION_VERSION (stale). */
function staleVerifiedCandidate(): VerifiedTacticalCandidate {
  return { ...scoped('mate-two'), detectionVersion: 1 };
}

/**
 * A MoveAnalysis record of a user (White) ply classified `blunder`. Defaults
 * to a distinct, real decision point (the missed-mate position before 4.d3);
 * override `ply`/`classification` to shape a scenario.
 */
function blunderRecord(ply: number, overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return makeMove(ply, {
    analysisId: ANALYSIS_ID,
    gameId: GAME_ID,
    side: 'white',
    classification: 'blunder',
    positionFen: scoped('mate-one').startingFen,
    playedMove: { san: 'd3', uci: 'd2d3' },
    bestMove: { san: 'Qxf7', uci: 'h5f7' },
    bestPv: ['h5f7'],
    evalBefore: { mate: 1, cp: null },
    evalAfter: { cp: -300, mate: null },
    ...overrides,
  });
}

function rawCandidate(): RawCandidate {
  return {
    id: 'raw:1',
    analysisId: ANALYSIS_ID,
    sourceGameId: GAME_ID,
    sourcePly: 7,
    startingFen: scoped('mate-one').startingFen,
    userMovePlayed: 'd2d3',
    bestMove: 'h5f7',
    bestPv: ['h5f7'],
    wpLoss: 20,
    evalCpBefore: null,
    evalCpAfterUserMove: null,
    candidateGenerationVersion: 2,
    createdAt: NOW - 1000,
  };
}

function seedSummary(
  summaries: FakeSummariesRepository,
  overrides: Partial<SummaryRow> = {},
): Promise<void> {
  return summaries.putForAnalysis({ ...baseSummaryRow(ANALYSIS_ID, GAME_ID, NOW), ...overrides });
}

async function run(service: PuzzleGenerationService, signal?: AbortSignal): Promise<void> {
  const game = { id: GAME_ID, userColor: 'white' as Color };
  await service.runPassForAnalysis(ANALYSIS_ID, game, signal);
}

describe('PuzzleGenerationService', () => {
  it('is an idempotent no-op when the summary already completed generation', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries, {
      puzzleState: 'completed',
      puzzleProgress: { done: 0, total: 0 },
      puzzleGeneratorVersion: PUZZLE_GENERATOR_VERSION,
    });
    const r = rig([...verifiedCandidates()], summaries);

    await run(r.service);

    const summary = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(summary.puzzleState).toBe('completed');
    expect(summary.puzzleProgress).toEqual({ done: 0, total: 0 });
    expect(summary.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);
    // The gate returned before reading/writing anything: no patches, no rows.
    expect(summaries.patches).toEqual([]);
    expect(await r.puzzles.countForGame(GAME_ID)).toBe(0);
  });

  it('leaves the state absent when there is no summary or detection has not settled', async () => {
    // No summary at all.
    const none = rig([], new FakeSummariesRepository());
    await run(none.service);
    expect((await none.summaries.getForAnalysis(ANALYSIS_ID))?.puzzleState).toBeUndefined();

    // Detection queued (never completed).
    const queued = new FakeSummariesRepository();
    await seedSummary(queued, { detectionState: 'queued', detectionVersion: null });
    const q = rig([...verifiedCandidates()], queued);
    await run(q.service);
    expect((await queued.getForAnalysis(ANALYSIS_ID))?.puzzleState).toBeUndefined();
    expect(await q.puzzles.countForGame(GAME_ID)).toBe(0);

    // Detection failed.
    const failed = new FakeSummariesRepository();
    await seedSummary(failed, { detectionState: 'failed', detectionVersion: null });
    const f = rig([...verifiedCandidates()], failed);
    await run(f.service);
    expect((await failed.getForAnalysis(ANALYSIS_ID))?.puzzleState).toBeUndefined();
  });

  it('leaves the state absent when the completed detection verdict is from an older version', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries, { detectionVersion: 1 });
    const r = rig([...verifiedCandidates()], summaries);

    await run(r.service);

    expect((await summaries.getForAnalysis(ANALYSIS_ID))?.puzzleState).toBeUndefined();
    expect(summaries.patches).toEqual([]);
    expect(await r.puzzles.countForGame(GAME_ID)).toBe(0);
  });

  it('completes with a real zero when the analysis has no verified candidates', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries);
    const r = rig(
      [{ ...rawCandidate(), verificationStatus: 'raw' }, staleVerifiedCandidate()],
      summaries,
    );

    await run(r.service);

    const summary = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(summary.puzzleState).toBe('completed');
    expect(summary.puzzleProgress).toEqual({ done: 0, total: 0 });
    expect(summary.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);
    expect(await r.puzzles.countForGame(GAME_ID)).toBe(0);
  });

  it('persists one immutable row per verified candidate and completes (progress 3/3)', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries);
    const r = rig(
      [
        ...verifiedCandidates(),
        staleVerifiedCandidate(),
        { ...rawCandidate(), verificationStatus: 'raw' },
      ],
      summaries,
    );

    await run(r.service);

    const summary = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(summary.puzzleState).toBe('completed');
    expect(summary.puzzleProgress).toEqual({ done: 3, total: 3 });
    expect(summary.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);
    // Detection fields are untouched (coexistence, plan R-2).
    expect(summary.detectionState).toBe('completed');
    expect(summary.detectionVersion).toBe(DETECTION_VERSION);
    expect(summary.missedTacticCount).toBe(0);
    expect(summary.classificationCounts).toEqual({
      best: 0,
      good: 0,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
    });

    // Rows: exactly the three current-version verified candidates, assembled
    // with this service's clock and ordered by sourcePly.
    const rows = await r.puzzles.listForGame(GAME_ID);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(r.verified.map((candidate) => assemblePuzzle(candidate, NOW)));
    expect(rows.map((row) => row.sourcePly)).toEqual([6, 8, 20]);
    expect(rows.every((row) => row.puzzleGeneratorVersion === PUZZLE_GENERATOR_VERSION)).toBe(true);
    expect(rows.every((row) => row.detectionVersion === DETECTION_VERSION)).toBe(true);

    // The state machine advanced through inProgress (0..3) then completed.
    const progressWrites = summaries.patches
      .filter((patch) => patch.puzzleProgress !== undefined)
      .map((patch) => patch.puzzleProgress);
    expect(progressWrites).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it('re-running after completion is a no-op and never duplicates rows', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries);
    const r = rig([...verifiedCandidates()], summaries);

    await run(r.service);
    const patchesAfterFirst = summaries.patches.length;
    await run(r.service);

    expect((await summaries.getForAnalysis(ANALYSIS_ID))?.puzzleState).toBe('completed');
    expect(summaries.patches.length).toBe(patchesAfterFirst);
    expect(await r.puzzles.countForGame(GAME_ID)).toBe(3);
    const rows = await r.puzzles.listForGame(GAME_ID);
    expect(new Set(rows.map((row) => `${row.sourceGameId}:${row.sourcePly}`)).size).toBe(3);
    // Re-adding an existing row is an idempotent no-op returning 0.
    expect(await r.puzzles.addIfAbsent([rows[0]!])).toBe(0);
  });

  it('an aborted pass leaves the summary queued + resumable and resume writes only the missing rows', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries);
    const controller = new AbortController();
    const r = rig([...verifiedCandidates()], summaries);
    // Abort right after the first candidate row is written so the next
    // candidate boundary observes the signal.
    let aborted = false;
    r.puzzles.onBeforeAdd = () => {
      if (!aborted) {
        aborted = true;
        controller.abort();
      }
    };

    await run(r.service, controller.signal);

    // Interrupted: resumable `queued` with real progress; one row persisted.
    const interrupted = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(interrupted.puzzleState).toBe('queued');
    expect(interrupted.puzzleProgress).toEqual({ done: 1, total: 3 });
    expect(await r.puzzles.countForGame(GAME_ID)).toBe(1);

    // Resume without aborting: the already-persisted row is skipped (add-only)
    // and only the two missing rows are written before completing.
    r.puzzles.onBeforeAdd = undefined;
    await run(r.service);

    const resumed = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(resumed.puzzleState).toBe('completed');
    expect(resumed.puzzleProgress).toEqual({ done: 3, total: 3 });
    expect(await r.puzzles.countForGame(GAME_ID)).toBe(3);
    expect(await r.puzzles.listForGame(GAME_ID)).toEqual(
      r.verified.map((candidate) => assemblePuzzle(candidate, NOW)),
    );
    // The resumed pass made one `addIfAbsent` call per candidate (3) on top of
    // the aborted run's single call (4 total); the existing row's natural-key
    // no-op returned 0 inside those calls.
    expect(r.puzzles.addCalls).toBe(4);
  });

  it('a write/assembly error flips the summary to failed and a retry completes', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries);
    const r = rig([...verifiedCandidates()], summaries);
    r.puzzles.failNextAdd = true;

    await run(r.service);

    const failed = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(failed.puzzleState).toBe('failed');
    expect(failed.puzzleProgress).toEqual({ done: 0, total: 3 });
    // A failed (non-completed) pass never carries a generator version.
    expect(failed.puzzleGeneratorVersion).toBeUndefined();
    // Detection fields are still intact after the failure write.
    expect(failed.detectionState).toBe('completed');
    expect(failed.detectionVersion).toBe(DETECTION_VERSION);

    // Retry through the same entry point completes the pass.
    await run(r.service);
    const retried = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(retried.puzzleState).toBe('completed');
    expect(retried.puzzleProgress).toEqual({ done: 3, total: 3 });
    expect(await r.puzzles.countForGame(GAME_ID)).toBe(3);
  });

  it('turns a user-side blunder ply that is not a verified candidate into a one-move correct-move puzzle', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries);
    const record = blunderRecord(10);
    // Only the user's ply-10 blunder; no verified candidate at that ply.
    const r = rig([], summaries, [record]);
    // Safety: the fixture record is genuinely a user White blunder with a
    // distinct best move, so the pass derives a correct-move puzzle from it.
    expect(record.classification).toBe('blunder');
    expect(record.side).toBe('white');

    await run(r.service);

    const summary = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(summary.puzzleState).toBe('completed');
    expect(summary.puzzleProgress).toEqual({ done: 1, total: 1 });
    expect(summary.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);

    const rows = await r.puzzles.listForGame(GAME_ID);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.origin).toBe('blunder');
    expect(row.sourcePly).toBe(10);
    // The solution is the ply's best move alone (one-move correct-move puzzle).
    expect(row.bestMove).toBe('h5f7');
    expect(row.bestPv).toEqual(['h5f7']);
    // No tactical-only fields on an honest blunder row.
    expect(row.tacticalObjective).toBeUndefined();
    expect(row.verificationMetadata).toBeUndefined();
    expect(row.candidateSolutionLength).toBeUndefined();
    expect(row.acceptedFirstMoves).toBeUndefined();
    expect(row.candidateGenerationVersion).toBeNull();
    expect(row.detectionVersion).toBe(DETECTION_VERSION);
    expect(row.puzzleGeneratorVersion).toBe(PUZZLE_GENERATOR_VERSION);
    // Deterministic provisional difficulty from the record's eval swing.
    expect(row.difficulty).toBe(blunderDifficultyOf(record.evalBefore, record.evalAfter));
    expect(row).toEqual(
      assembleBlunderPuzzle(
        {
          sourceGameId: GAME_ID,
          analysisId: ANALYSIS_ID,
          sourcePly: record.ply,
          startingFen: record.positionFen,
          userMovePlayed: record.playedMove.uci,
          bestMove: record.bestMove!.uci,
          evalBefore: record.evalBefore,
          evalAfter: record.evalAfter,
          detectionVersion: DETECTION_VERSION,
        },
        NOW,
      ),
    );
  });

  it('ignores opponent plies, non-blunder user plies and blunders without a best move', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries);
    const r = rig([], summaries, [
      // Black (opponent) blunder — never a user puzzle.
      blunderRecord(3, { side: 'black' }),
      // User mistake (below the blunder band) — never a correct-move puzzle.
      blunderRecord(4, { classification: 'mistake' }),
      // User blunder with no engine best move — nothing to derive.
      blunderRecord(6, { bestMove: null }),
    ]);

    await run(r.service);

    const summary = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(summary.puzzleState).toBe('completed');
    expect(summary.puzzleProgress).toEqual({ done: 0, total: 0 });
    expect(await r.puzzles.countForGame(GAME_ID)).toBe(0);
  });

  it('a ply that is both a verified candidate and a user blunder keeps the tactical row', async () => {
    const summaries = new FakeSummariesRepository();
    await seedSummary(summaries);
    const verified = verifiedCandidates();
    const r = rig(verified, summaries, [
      // Ply 6 is BOTH the verified mate-one candidate and a user blunder.
      blunderRecord(6),
      // A pure user blunder at ply 10 (no candidate) still becomes a puzzle.
      blunderRecord(10),
    ]);

    await run(r.service);

    const summary = (await summaries.getForAnalysis(ANALYSIS_ID))!;
    expect(summary.puzzleState).toBe('completed');
    // Items settled: 3 verified candidates + 2 blunder plies. Ply 6 settles
    // twice (candidate row + blunder skipped by the natural key).
    expect(summary.puzzleProgress).toEqual({ done: 5, total: 5 });

    const rows = await r.puzzles.listForGame(GAME_ID);
    expect(rows.map((row) => row.sourcePly)).toEqual([6, 8, 10, 20]);
    const ply6 = rows.find((row) => row.sourcePly === 6)!;
    expect(ply6.origin).toBe('tactical');
    expect(ply6.tacticalObjective).toBe('forcing_mate');
    expect(ply6.difficulty).toBe(12);
    const ply10 = rows.find((row) => row.sourcePly === 10)!;
    expect(ply10.origin).toBe('blunder');
    expect(ply10.bestPv).toEqual(['h5f7']);
  });
});
