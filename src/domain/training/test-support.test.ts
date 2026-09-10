import { describe, expect, it } from 'vitest';
import { walkLine } from '@/domain/tactics';
import {
  PUZZLE_FIXTURE_KINDS,
  PUZZLE_FIXTURE_NOW,
  blunderRowFixture,
  puzzleRowFixture,
} from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { applyMove, beginPresentation, playedLine, presentationSolved } from './solve';
import {
  DEFAULT_CYCLE_ID,
  DEFAULT_PRESENTATION_INDEX,
  DEFAULT_TRAINING_SET_ID,
  TRAINING_FIXTURE_KINDS,
  attemptRowFixture,
  attemptRowsForCycle,
  cycleAttemptFixture,
  cycleContextFixture,
  cycleFixture,
  poolEntryFixture,
  setFixture,
  solveConfigFixture,
  terminalAlternativeRowFixture,
  trainingRowFixture,
  trainingSupplementaryFixtures,
} from './test-support';
import { CYCLE_METRICS_VERSION, DEFAULT_CYCLE_CONFIG, DEFAULT_TARGET_SIZE } from './cycleTypes';

describe('supplementary training fixtures', () => {
  it('covers the presentation cases Feature-011 does not', () => {
    expect([...TRAINING_FIXTURE_KINDS]).toEqual(['promotion', 'en-passant', 'castling']);
  });

  it('walks every supplementary bestPv legally from its startingFen (no engine)', () => {
    for (const kind of TRAINING_FIXTURE_KINDS) {
      const row = trainingRowFixture(kind);
      const walked = walkLine(row.startingFen, row.bestPv);
      expect(walked.ok, `${kind}: ${walked.ok ? '' : walked.message}`).toBe(true);
      expect(row.bestPv[0]).toBe(row.bestMove);
      expect(row.sideToMove).toBe('white');
      expect(row.origin).toBe('tactical');
    }
  });

  it('keeps every accepted first move legal from the starting position', () => {
    for (const kind of TRAINING_FIXTURE_KINDS) {
      const row = trainingRowFixture(kind);
      for (const firstMove of row.acceptedFirstMoves ?? [row.bestMove]) {
        const walked = walkLine(row.startingFen, [firstMove]);
        expect(walked.ok, `${kind} ${firstMove}: ${walked.ok ? '' : walked.message}`).toBe(true);
      }
    }
  });

  it('is deterministic across calls', () => {
    for (const kind of TRAINING_FIXTURE_KINDS) {
      expect(trainingRowFixture(kind)).toEqual(trainingSupplementaryFixtures[kind]);
    }
  });

  it('re-exposes the terminal accepted-alternative row of Feature-011', () => {
    expect(terminalAlternativeRowFixture()).toEqual(puzzleRowFixture('accepted-alternatives'));
  });
});

describe('fixture walkability through the domain solver (Stage F closure)', () => {
  const solverRows: ReadonlyArray<{ readonly label: string; readonly row: PuzzleRow }> = [
    { label: 'blunder-correct-move', row: blunderRowFixture('correct-move') },
    ...PUZZLE_FIXTURE_KINDS.map((kind) => ({
      label: `tactical-${kind}`,
      row: puzzleRowFixture(kind),
    })),
    ...TRAINING_FIXTURE_KINDS.map((kind) => ({
      label: `edge-${kind}`,
      row: trainingRowFixture(kind),
    })),
  ];

  it('walks every deterministic fixture row to a solved end (both origins, multi-move, promotion/en-passant/castling)', () => {
    for (const { label, row } of solverRows) {
      const began = beginPresentation(row, PUZZLE_FIXTURE_NOW);
      expect(began.ok, `${label}: ${began.ok ? '' : began.message}`).toBe(true);
      if (!began.ok) {
        continue;
      }
      let state = began.state;
      for (let index = 0; index < row.bestPv.length; index += 2) {
        const userToken = row.bestPv[index];
        if (userToken === undefined) {
          break;
        }
        const result = applyMove(state, userToken);
        expect(result.kind, `${label}: expected user move ${userToken} to be accepted`).toBe(
          'accepted',
        );
        if (result.kind === 'accepted') {
          state = result.state;
        }
      }
      expect(presentationSolved(state), label).toBe(true);
      // Line parity holds at the solved end: the played line is the stored branch.
      expect(playedLine(state), label).toEqual(row.bestPv);
    }
  });

  it('walks every stored accepted first move besides bestMove as a terminal solve', () => {
    const row = puzzleRowFixture('accepted-alternatives');
    const began = beginPresentation(row, PUZZLE_FIXTURE_NOW);
    expect(began.ok).toBe(true);
    if (!began.ok) {
      throw new Error(began.message);
    }
    const alternatives = (row.acceptedFirstMoves ?? []).filter((move) => move !== row.bestMove);
    expect(alternatives.length).toBeGreaterThan(0);
    for (const firstMove of alternatives) {
      const result = applyMove(began.state, firstMove);
      expect(result.kind, `alternative ${firstMove}`).toBe('accepted');
      if (result.kind !== 'accepted') {
        continue;
      }
      expect(result.solved).toBe(true);
      expect(playedLine(result.state)).toEqual([firstMove]);
    }
  });
});

describe('shared session fixtures', () => {
  it('builds a default solve config that starts with a visible level-2 press', () => {
    expect(solveConfigFixture()).toEqual({ enabledLevels: [2, 3, 4], firstHintLevel: 2 });
  });

  it('builds a deterministic cycle context', () => {
    expect(cycleContextFixture('cycle-1', 'fixture:mate-one', 3)).toEqual({
      trainingSetId: DEFAULT_TRAINING_SET_ID,
      cycleId: 'cycle-1',
      presentationIndex: 3,
    });
    expect(
      cycleContextFixture(DEFAULT_CYCLE_ID, 'fixture:mate-one', DEFAULT_PRESENTATION_INDEX),
    ).toEqual({
      trainingSetId: DEFAULT_TRAINING_SET_ID,
      cycleId: DEFAULT_CYCLE_ID,
      presentationIndex: DEFAULT_PRESENTATION_INDEX,
    });
  });

  it('builds a deterministic, walkable-adjacent attempt row over fixture clock', () => {
    const attempt = attemptRowFixture();
    expect(attempt.startedAt).toBe(PUZZLE_FIXTURE_NOW);
    expect(attempt.solvingTimeMs).toBe(5_000);
    expect(attempt.result).toBe('solvedFirstTry');
  });
});

describe('Feature-013 set/cycle fixtures', () => {
  it('builds a deterministic default set', () => {
    expect(setFixture()).toEqual({
      id: DEFAULT_TRAINING_SET_ID,
      name: 'Fixture set',
      createdAt: PUZZLE_FIXTURE_NOW,
      updatedAt: PUZZLE_FIXTURE_NOW,
      status: 'active',
      source: { kind: 'manual' },
      puzzleIds: [],
      targetSize: DEFAULT_TARGET_SIZE,
      config: DEFAULT_CYCLE_CONFIG,
    });
  });

  it('does not alias the shared default config', () => {
    const set = setFixture();
    expect(set.config).not.toBe(DEFAULT_CYCLE_CONFIG);
    expect(set.config.hints.enabledLevels).not.toBe(DEFAULT_CYCLE_CONFIG.hints.enabledLevels);
  });

  it('builds a deterministic default cycle', () => {
    expect(cycleFixture()).toMatchObject({
      id: DEFAULT_CYCLE_ID,
      trainingSetId: DEFAULT_TRAINING_SET_ID,
      cycleNumber: 1,
      status: 'inProgress',
      startedAt: PUZZLE_FIXTURE_NOW,
      completedAt: null,
      abandonedAt: null,
      puzzleIds: [],
      cycleMetricsVersion: CYCLE_METRICS_VERSION,
    });
  });

  it('derives attempt counters from the result unless overridden', () => {
    const failed = cycleAttemptFixture({ puzzleId: 'p1', result: 'failed' });
    expect(failed).toMatchObject({
      result: 'failed',
      wrongMoveCount: 1,
      hintCount: 0,
      solved: false,
      presentationIndex: 1,
      origin: 'tactical',
    });
    const helped = cycleAttemptFixture({ puzzleId: 'p1', result: 'solvedWithHelp' });
    expect(helped).toMatchObject({
      result: 'solvedWithHelp',
      wrongMoveCount: 0,
      hintCount: 1,
      highestHintLevel: 2,
      solved: true,
    });
  });

  it('builds a deterministic enriched pool entry', () => {
    expect(poolEntryFixture()).toMatchObject({
      puzzle: puzzleRowFixture('mate-one'),
      platform: 'lichess',
      timeControlCategory: 'blitz',
    });
  });

  it('builds deterministic attempt rows per puzzle and presentation', () => {
    const input = {
      puzzleIds: ['p1', 'p2'],
      results: { p1: ['failed', 'solvedFirstTry'], p2: ['skipped'] },
    } as const;
    const built = attemptRowsForCycle(input);
    expect(built.map((row) => [row.puzzleId, row.presentationIndex])).toEqual([
      ['p1', 1],
      ['p1', 2],
      ['p2', 1],
    ]);
    expect(attemptRowsForCycle(input)).toEqual(built);
  });
});
