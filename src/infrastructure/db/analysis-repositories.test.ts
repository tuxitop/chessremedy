import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './database';
import { analysesRepository } from './analysis-repository';
import { analysisJobsRepository } from './analysis-jobs-repository';
import { DexieEngineAnalysisCache } from './engine-cache-repository';
import { summariesRepository } from './summaries-repository';
import {
  puzzleCandidatesRepository,
  type UnverifiedPuzzleCandidateRow,
} from './candidates-repository';
import type { AnalysisSummaryRow } from './summaries-repository';
import { puzzlesRepository } from './puzzles-repository';
import { makeJob, makeRecords, TEST_ENGINE } from '@/domain/analysis/test-support';
import { markCompleted, markFailed, markInProgress } from '@/domain/analysis';
import { buildAnalysisSummary, type PerAnalysisSummary } from '@/domain/analysis/summaryDerivation';
import { puzzleRowFixture } from '@/domain/puzzle/test-support';
import type { VerifiedTacticalCandidate } from '@/domain/tactics';
import { CANDIDATE_GENERATION_VERSION, DETECTION_VERSION } from '@/domain/tactics';
import type { Color } from 'chessops/types';
import type { MoveAnalysis } from '@/domain/chess';

const GAME = 'lichess:abc';
const ANALYSIS_A = `${GAME}|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal`;

describe('analysis repository', () => {
  beforeEach(async () => {
    await db.analyses.clear();
    await db.analysisJobs.clear();
    await db.positionAnalysisCache.clear();
  });

  it('replaces a run atomically and queries by game and analysis identity', async () => {
    await analysesRepository.replaceAnalysis(makeRecords(GAME, ANALYSIS_A, 3));
    expect(await analysesRepository.countForGame(GAME)).toBe(3);

    const byGame = await analysesRepository.listForGame(GAME);
    expect(byGame.map((r) => r.ply)).toEqual([0, 1, 2]);

    const byPair = await analysesRepository.listForGameAndAnalysis(GAME, ANALYSIS_A);
    expect(byPair).toHaveLength(3);

    // Replacing the same analysis identity with fewer rows removes leftovers.
    await analysesRepository.replaceAnalysis(makeRecords(GAME, ANALYSIS_A, 1));
    expect(await analysesRepository.countForGame(GAME)).toBe(1);
  });

  it('keeps distinct analysis identities separate for one game', async () => {
    const other = `${ANALYSIS_A}#fast`;
    await analysesRepository.replaceAnalysis(makeRecords(GAME, ANALYSIS_A, 2));
    await analysesRepository.replaceAnalysis(makeRecords(GAME, other, 4));
    expect(await analysesRepository.countForGame(GAME)).toBe(6);
    expect(await analysesRepository.listForGameAndAnalysis(GAME, other)).toHaveLength(4);
  });

  it('deletes game-scoped records', async () => {
    await analysesRepository.replaceAnalysis(makeRecords(GAME, ANALYSIS_A, 2));
    await analysesRepository.deleteForGames([GAME]);
    expect(await analysesRepository.countForGame(GAME)).toBe(0);
    expect(await db.analyses.count()).toBe(0);
  });
});

describe('analysis jobs repository', () => {
  beforeEach(async () => {
    await db.analysisJobs.clear();
  });

  it('persists, reads and deletes one job', async () => {
    let job = makeJob(GAME, 40);
    job = markInProgress(job, 2);
    await analysisJobsRepository.putJob(job);
    expect((await analysisJobsRepository.getJob(job.id))!.state).toBe('inProgress');

    await analysisJobsRepository.deleteJob(job.id);
    expect(await analysisJobsRepository.getJob(job.id)).toBeUndefined();
  });

  it('lists jobs by game, by many games and by state', async () => {
    const a = markCompleted(makeJob(GAME, 10), 2);
    const b = markFailed(makeJob('lichess:other', 5), 'boom', 3);
    await analysisJobsRepository.putJob(a);
    await analysisJobsRepository.putJob(b);

    expect((await analysisJobsRepository.listByGame(GAME)).map((j) => j.id)).toEqual([a.id]);
    expect(
      (await analysisJobsRepository.listByGames([GAME, 'lichess:other'])).map((j) => j.id).sort(),
    ).toEqual([a.id, b.id].sort());
    expect(await analysisJobsRepository.listByState('failed')).toHaveLength(1);
  });

  it('deletes game-scoped jobs', async () => {
    await analysisJobsRepository.putJob(makeJob(GAME, 2));
    await analysisJobsRepository.deleteForGames([GAME]);
    expect(await analysisJobsRepository.listByGame(GAME)).toHaveLength(0);
  });
});

describe('engine analysis cache repository (ADR-018)', () => {
  beforeEach(async () => {
    await db.positionAnalysisCache.clear();
  });

  it('round-trips results keyed by the ADR-018 tuple', async () => {
    const cache = new DexieEngineAnalysisCache();
    await cache.put('fen|normal|stockfish@18.0.8@stockfish-18-lite-single', {
      jobId: 'j1',
      position: 'start',
      profile: 'normal',
      lines: [
        {
          multipv: 1,
          evaluation: { cp: 21 },
          principalVariation: [{ uci: 'e2e4' }],
          wdl: null,
        },
      ],
      engine: TEST_ENGINE,
      timeMs: 3,
    });
    expect(await cache.count()).toBe(1);
    const stored = await cache.get('fen|normal|stockfish@18.0.8@stockfish-18-lite-single');
    expect(stored?.lines[0]?.evaluation).toEqual({ cp: 21 });
    expect(await cache.get('missing')).toBeUndefined();
  });
});

const OTHER_GAME = 'lichess:other';
const ANALYSIS_B = `${GAME}|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal#b`;
const OTHER_ANALYSIS = `${OTHER_GAME}|a1|c1|p1|stockfish@18.0.8@stockfish-18-lite-single@normal`;
const NOW = 1_700_000_000_000;

function summaryRowFor(
  gameId: string,
  analysisId: string,
  userColor: Color,
  records: readonly MoveAnalysis[],
  options: Parameters<typeof buildAnalysisSummary>[2] = {},
  updatedAt = 5,
): AnalysisSummaryRow {
  const built: PerAnalysisSummary = buildAnalysisSummary(records, userColor, options);
  return { analysisId, gameId, userColor, updatedAt, ...built };
}

function verifiedRow(
  gameId: string,
  analysisId: string,
  sourcePly: number,
  overrides: Partial<VerifiedTacticalCandidate> = {},
): VerifiedTacticalCandidate {
  return {
    id: `${analysisId}:${sourcePly}`,
    analysisId,
    sourceGameId: gameId,
    sourcePly,
    startingFen: 'r1bqkb1r/pppp1pp1/2n2n1p/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5',
    userMovePlayed: 'h7h6',
    bestMove: 'g5f7',
    bestPv: ['g5f7', 'd8e7', 'f7h8'],
    wpLoss: 42.3,
    evalCpBefore: 300,
    evalCpAfterUserMove: -180,
    candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
    createdAt: NOW,
    updatedAt: NOW,
    tacticalObjective: 'winning_material',
    candidateSolutionLength: 3,
    verificationMetadata: {
      engineName: TEST_ENGINE.engineName,
      engineVersion: TEST_ENGINE.engineVersion,
      engineBuild: TEST_ENGINE.engineBuild,
      analysisVersion: 1,
      verificationDepth: 22,
      verificationTimestamp: NOW,
      wdlAfterBestLine: { w: 950, d: 40, l: 10 },
    },
    detectionVersion: DETECTION_VERSION,
    verificationStatus: 'verified',
    ...overrides,
  };
}

function unverifiedRow(
  gameId: string,
  analysisId: string,
  sourcePly: number,
  status: 'raw' | 'failed',
  overrides: Partial<UnverifiedPuzzleCandidateRow> = {},
): UnverifiedPuzzleCandidateRow {
  return {
    id: `${analysisId}:${sourcePly}`,
    analysisId,
    sourceGameId: gameId,
    sourcePly,
    startingFen: 'r1bqkb1r/pppp1pp1/2n2n1p/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5',
    userMovePlayed: 'h7h6',
    bestMove: 'g5f7',
    bestPv: ['g5f7', 'd8e7'],
    wpLoss: 28.7,
    evalCpBefore: 120,
    evalCpAfterUserMove: -240,
    candidateGenerationVersion: CANDIDATE_GENERATION_VERSION,
    createdAt: NOW,
    updatedAt: NOW,
    verificationStatus: status,
    ...overrides,
  };
}

describe('analysis summaries repository', () => {
  beforeEach(async () => {
    await db.analysisSummaries.clear();
  });

  it('round-trips one per-analysis summary and deletes it by analysis id', async () => {
    const row = summaryRowFor(GAME, ANALYSIS_A, 'white', makeRecords(GAME, ANALYSIS_A, 6), {
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: DETECTION_VERSION,
    });
    await summariesRepository.putForAnalysis(row);

    const stored = await summariesRepository.getForAnalysis(ANALYSIS_A);
    expect(stored).toEqual(row);
    expect(stored?.gameId).toBe(GAME);
    expect(stored?.detectionState).toBe('completed');
    expect(stored?.missedTacticCount).toBe(0);
    expect(await summariesRepository.getForAnalysis('missing')).toBeUndefined();

    await summariesRepository.deleteForAnalysis(ANALYSIS_A);
    expect(await summariesRepository.getForAnalysis(ANALYSIS_A)).toBeUndefined();
  });

  it('carries the additive verificationDepth provenance (no schema bump)', async () => {
    const row = summaryRowFor(GAME, ANALYSIS_A, 'white', makeRecords(GAME, ANALYSIS_A, 6), {
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: DETECTION_VERSION,
      verificationDepth: 30,
    });
    await summariesRepository.putForAnalysis(row);

    const stored = await summariesRepository.getForAnalysis(ANALYSIS_A);
    expect(stored?.verificationDepth).toBe(30);
  });

  it('patchForAnalysis merges only the given fields and never clobbers the other fields', async () => {
    const row = summaryRowFor(GAME, ANALYSIS_A, 'white', makeRecords(GAME, ANALYSIS_A, 6), {
      detectionState: 'completed',
      missedTacticCount: 0,
      detectionVersion: DETECTION_VERSION,
    });
    await summariesRepository.putForAnalysis(row);

    // A puzzle-state patch updates only the puzzle fields…
    await summariesRepository.patchForAnalysis(ANALYSIS_A, {
      puzzleState: 'inProgress',
      puzzleProgress: { done: 1, total: 2 },
    });
    let stored = await summariesRepository.getForAnalysis(ANALYSIS_A);
    expect(stored?.puzzleState).toBe('inProgress');
    expect(stored?.puzzleProgress).toEqual({ done: 1, total: 2 });
    // …and preserves the detection machine's fields untouched.
    expect(stored?.detectionState).toBe('completed');
    expect(stored?.missedTacticCount).toBe(0);
    expect(stored?.detectionVersion).toBe(DETECTION_VERSION);
    expect(stored?.puzzleGeneratorVersion).toBeNull();

    // A later patch to the completed puzzle state lands on the same row.
    await summariesRepository.patchForAnalysis(ANALYSIS_A, { puzzleState: 'completed' });
    stored = await summariesRepository.getForAnalysis(ANALYSIS_A);
    expect(stored?.puzzleState).toBe('completed');
    expect(stored?.detectionState).toBe('completed');
    expect(stored?.missedTacticCount).toBe(0);

    // Patching an absent analysis is a silent no-op.
    await summariesRepository.patchForAnalysis('missing', { puzzleState: 'completed' });
    expect(await summariesRepository.getForAnalysis('missing')).toBeUndefined();
  });

  it('keeps a non-completed detection holder absent (null count/version)', async () => {
    const row = summaryRowFor(GAME, ANALYSIS_A, 'white', makeRecords(GAME, ANALYSIS_A, 6), {
      detectionState: 'queued',
      missedTacticCount: 0,
      detectionVersion: 1,
    });
    await summariesRepository.putForAnalysis(row);
    const stored = await summariesRepository.getForAnalysis(ANALYSIS_A);
    expect(stored?.detectionState).toBe('queued');
    expect(stored?.missedTacticCount).toBeNull();
    expect(stored?.detectionVersion).toBeNull();
  });

  it('lists summaries by analysis ids and by games', async () => {
    const a = summaryRowFor(GAME, ANALYSIS_A, 'white', makeRecords(GAME, ANALYSIS_A, 2));
    const b = summaryRowFor(GAME, ANALYSIS_B, 'black', makeRecords(GAME, ANALYSIS_B, 2));
    const other = summaryRowFor(
      OTHER_GAME,
      OTHER_ANALYSIS,
      'white',
      makeRecords(OTHER_GAME, OTHER_ANALYSIS, 2),
    );
    await summariesRepository.putForAnalysis(a);
    await summariesRepository.putForAnalysis(b);
    await summariesRepository.putForAnalysis(other);

    expect(await summariesRepository.listForAnalysisIds([])).toEqual([]);
    expect(
      (await summariesRepository.listForAnalysisIds([ANALYSIS_A, OTHER_ANALYSIS]))
        .map((s) => s.analysisId)
        .sort(),
    ).toEqual([ANALYSIS_A, OTHER_ANALYSIS].sort());

    expect(await summariesRepository.listForGames([])).toEqual([]);
    expect(
      (await summariesRepository.listForGames([GAME])).map((s) => s.analysisId).sort(),
    ).toEqual([ANALYSIS_A, ANALYSIS_B].sort());
    expect(
      (await summariesRepository.listForGames([GAME, OTHER_GAME])).map((s) => s.analysisId).sort(),
    ).toEqual([ANALYSIS_A, ANALYSIS_B, OTHER_ANALYSIS].sort());
  });

  it('deletes summaries per game and per analysis id', async () => {
    const a = summaryRowFor(GAME, ANALYSIS_A, 'white', makeRecords(GAME, ANALYSIS_A, 2));
    const b = summaryRowFor(GAME, ANALYSIS_B, 'white', makeRecords(GAME, ANALYSIS_B, 2));
    const other = summaryRowFor(
      OTHER_GAME,
      OTHER_ANALYSIS,
      'white',
      makeRecords(OTHER_GAME, OTHER_ANALYSIS, 2),
    );
    await summariesRepository.putForAnalysis(a);
    await summariesRepository.putForAnalysis(b);
    await summariesRepository.putForAnalysis(other);

    await summariesRepository.deleteForAnalysis(ANALYSIS_A);
    expect(await summariesRepository.getForAnalysis(ANALYSIS_A)).toBeUndefined();
    expect(await summariesRepository.getForAnalysis(ANALYSIS_B)).toBeDefined();

    await summariesRepository.deleteForGames([GAME]);
    expect(await summariesRepository.getForAnalysis(ANALYSIS_B)).toBeUndefined();
    expect(await summariesRepository.getForAnalysis(OTHER_ANALYSIS)).toBeDefined();
  });
});

describe('puzzle candidates repository', () => {
  beforeEach(async () => {
    await db.puzzleCandidates.clear();
  });

  it('round-trips verified candidates under their natural key with full metadata', async () => {
    const verified = verifiedRow(GAME, ANALYSIS_A, 7);
    await puzzleCandidatesRepository.bulkPutForAnalysis([verified]);

    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(GAME, ANALYSIS_A);
    expect(rows).toEqual([verified]);
    expect(rows[0]?.verificationStatus).toBe('verified');
    expect((rows[0] as VerifiedTacticalCandidate).verificationMetadata).toEqual(
      verified.verificationMetadata,
    );
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(OTHER_GAME, ANALYSIS_A)).toEqual(
      [],
    );
  });

  it('stores unverified (raw/failed) rows as-is with wpLoss present', async () => {
    const raw = unverifiedRow(GAME, ANALYSIS_A, 3, 'raw', {
      evalCpBefore: null,
      evalCpAfterUserMove: null,
    });
    const failed = unverifiedRow(GAME, ANALYSIS_A, 5, 'failed', { wpLoss: 61.1 });
    await puzzleCandidatesRepository.bulkPutForAnalysis([raw, failed]);

    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(GAME, ANALYSIS_A);
    expect(rows).toEqual([raw, failed]);
    expect(rows.map((r) => r.verificationStatus)).toEqual(['raw', 'failed']);
    expect(rows[0]?.wpLoss).toBe(raw.wpLoss);
    expect(rows[1]?.wpLoss).toBe(61.1);
    expect(rows[0]?.evalCpBefore).toBeNull();
    // Unverified rows carry no verification-only fields.
    expect('tacticalObjective' in rows[0]!).toBe(false);
  });

  it('lists only verified candidates for a game, sorted by source ply', async () => {
    await puzzleCandidatesRepository.bulkPutForAnalysis([
      verifiedRow(GAME, ANALYSIS_A, 4),
      unverifiedRow(GAME, ANALYSIS_B, 2, 'raw'),
      unverifiedRow(GAME, ANALYSIS_B, 6, 'failed'),
      verifiedRow(GAME, ANALYSIS_B, 0),
      verifiedRow(OTHER_GAME, OTHER_ANALYSIS, 1),
    ]);

    const verified = await puzzleCandidatesRepository.listVerifiedForGame(GAME);
    expect(verified.map((c) => c.sourcePly)).toEqual([0, 4]);
    expect(verified.map((c) => c.analysisId)).toEqual([ANALYSIS_B, ANALYSIS_A]);
  });

  it('flips a candidate status by its [analysisId, sourcePly] natural key', async () => {
    await puzzleCandidatesRepository.bulkPutForAnalysis([
      unverifiedRow(GAME, ANALYSIS_A, 7, 'raw'),
    ]);
    await puzzleCandidatesRepository.updateStatus(ANALYSIS_A, 7, 'failed');

    const rows = await puzzleCandidatesRepository.listForGameAndAnalysis(GAME, ANALYSIS_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verificationStatus).toBe('failed');
    // Other candidates are untouched.
    expect(await puzzleCandidatesRepository.listVerifiedForGame(GAME)).toEqual([]);
  });

  it('deletes candidates per analysis and per game, keeping other games', async () => {
    await puzzleCandidatesRepository.bulkPutForAnalysis([
      verifiedRow(GAME, ANALYSIS_A, 2),
      unverifiedRow(GAME, ANALYSIS_B, 4, 'failed'),
      verifiedRow(OTHER_GAME, OTHER_ANALYSIS, 1),
    ]);

    await puzzleCandidatesRepository.deleteForAnalysis(ANALYSIS_A);
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(GAME, ANALYSIS_A)).toEqual([]);
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(GAME, ANALYSIS_B)).toHaveLength(
      1,
    );

    await puzzleCandidatesRepository.deleteForGames([GAME]);
    expect(await puzzleCandidatesRepository.listForGameAndAnalysis(GAME, ANALYSIS_B)).toEqual([]);
    expect(
      await puzzleCandidatesRepository.listForGameAndAnalysis(OTHER_GAME, OTHER_ANALYSIS),
    ).toEqual([verifiedRow(OTHER_GAME, OTHER_ANALYSIS, 1)]);
  });
});

describe('puzzles repository', () => {
  beforeEach(async () => {
    await db.puzzles.clear();
  });

  /** A Feature-011 puzzle row at the given `(sourceGameId, sourcePly)` key. */
  function puzzleRow(sourceGameId: string, analysisId: string, sourcePly: number) {
    return {
      ...puzzleRowFixture('material-combination'),
      sourceGameId,
      sourcePly,
      analysisId,
    };
  }

  it('addIfAbsent is first-wins and idempotent over the natural key', async () => {
    const original = puzzleRow(GAME, ANALYSIS_A, 2);
    expect(await puzzlesRepository.addIfAbsent([original])).toBe(1);
    // Re-adding the identical row is a no-op …
    expect(await puzzlesRepository.addIfAbsent([original])).toBe(0);
    // … and so is a different row at an already-present (game, sourcePly) key:
    // the original immutable row is never overwritten.
    const different = {
      ...puzzleRowFixture('mate-one'),
      sourceGameId: GAME,
      sourcePly: 2,
      analysisId: ANALYSIS_A,
    };
    expect(await puzzlesRepository.addIfAbsent([different])).toBe(0);
    expect(await puzzlesRepository.getPuzzle(GAME, 2)).toEqual(original);
    expect(await puzzlesRepository.countForGame(GAME)).toBe(1);
    // An empty batch is a no-op.
    expect(await puzzlesRepository.addIfAbsent([])).toBe(0);
  });

  it('round-trips by natural key and lists a game ordered by sourcePly', async () => {
    await puzzlesRepository.addIfAbsent([
      puzzleRow(GAME, ANALYSIS_A, 6),
      puzzleRow(GAME, ANALYSIS_A, 0),
      puzzleRow(GAME, ANALYSIS_A, 3),
    ]);

    expect((await puzzlesRepository.listForGame(GAME)).map((r) => r.sourcePly)).toEqual([0, 3, 6]);
    expect((await puzzlesRepository.getPuzzle(GAME, 3))?.sourcePly).toBe(3);
    expect(await puzzlesRepository.getPuzzle(GAME, 99)).toBeUndefined();
    // listForGame is scoped to one game.
    expect(await puzzlesRepository.listForGame(OTHER_GAME)).toEqual([]);
  });

  it('counts per game, per set of games and absent games as zero', async () => {
    await puzzlesRepository.addIfAbsent([
      puzzleRow(GAME, ANALYSIS_A, 0),
      puzzleRow(GAME, ANALYSIS_A, 2),
      puzzleRow(OTHER_GAME, OTHER_ANALYSIS, 4),
    ]);

    expect(await puzzlesRepository.countForGame(GAME)).toBe(2);
    expect(await puzzlesRepository.countForGame('lichess:none')).toBe(0);
    expect(await puzzlesRepository.countForGames([])).toEqual({});
    expect(await puzzlesRepository.countForGames([GAME, OTHER_GAME, 'lichess:none'])).toEqual({
      [GAME]: 2,
      [OTHER_GAME]: 1,
      'lichess:none': 0,
    });
  });

  it('deletes puzzles per game, keeping other games rows', async () => {
    await puzzlesRepository.addIfAbsent([
      puzzleRow(GAME, ANALYSIS_A, 0),
      puzzleRow(GAME, ANALYSIS_A, 2),
      puzzleRow(OTHER_GAME, OTHER_ANALYSIS, 4),
    ]);

    await puzzlesRepository.deleteForGames([GAME]);
    expect(await puzzlesRepository.listForGame(GAME)).toEqual([]);
    expect(await puzzlesRepository.countForGame(GAME)).toBe(0);
    expect((await puzzlesRepository.listForGame(OTHER_GAME)).map((r) => r.sourcePly)).toEqual([4]);
    // An empty game set is a no-op.
    await puzzlesRepository.deleteForGames([]);
    expect(await db.puzzles.count()).toBe(1);
  });
});
