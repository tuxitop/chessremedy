import { describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { buildAttemptRow } from '@/domain/training';

import {
  PUZZLE_FIXTURE_NOW,
  puzzleRowFixture,
  blunderRowFixture,
} from '@/domain/puzzle/test-support';
import { PuzzleAttemptWriteError } from '@/infrastructure/training';
import type { PuzzleAttemptRecorderLike, RecordAttemptInput } from '@/infrastructure/training';
import {
  cycleContextFixture,
  solveConfigFixture,
  terminalAlternativeRowFixture,
} from '@/domain/training/test-support';
import type { PuzzleRow } from '@/domain/puzzle';
import { usePuzzleSolve } from './usePuzzleSolve';

const NOW = PUZZLE_FIXTURE_NOW;

interface RecorderRig {
  readonly recorder: PuzzleAttemptRecorderLike;
  readonly calls: RecordAttemptInput[];
  failNextWrite(): void;
}

function createRecorderRig(): RecorderRig {
  const calls: RecordAttemptInput[] = [];
  let failNext = false;
  const recorder: PuzzleAttemptRecorderLike = {
    async record(input) {
      calls.push(input);
      if (failNext) {
        failNext = false;
        throw new PuzzleAttemptWriteError(
          buildAttemptRow({ ...input, endedAt: input.endedAt ?? 1_700_000_000_000 }),
          new Error('simulated disk error'),
        );
      }
      return {
        status: 'written',
        attemptRow: buildAttemptRow({ ...input, endedAt: input.endedAt ?? 1_700_000_000_000 }),
      };
    },
  };
  return {
    recorder,
    calls,
    failNextWrite() {
      failNext = true;
    },
  };
}

function renderSolve(row: PuzzleRow, rig: RecorderRig) {
  return renderHook(() =>
    usePuzzleSolve({
      row,
      context: cycleContextFixture('fixture:cycle', `${row.sourceGameId}:${row.sourcePly}`, 1),
      config: solveConfigFixture(),
      recorder: rig.recorder,
      now: () => NOW,
    }),
  );
}

describe('usePuzzleSolve — presentation controller (Feature 012, Stage D)', () => {
  it('starts a fresh presentation: position at startingFen, zero counters, entry at the decision point', () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(blunderRowFixture(), rig);

    expect(result.current.stage).toBe('solving');
    expect(result.current.loadError).toBeNull();
    expect(result.current.orientation).toBe('white');
    expect(result.current.position).not.toBeNull();
    expect(result.current.decisionPosition).not.toBeNull();
    expect(result.current.playedLine).toEqual([]);
    expect(result.current.viewPly).toBe(0);
    expect(result.current.atDecisionPoint).toBe(true);
    expect(result.current.wrongMoveCount).toBe(0);
    expect(result.current.hintCount).toBe(0);
    expect(result.current.highestHintLevel).toBeNull();
    expect(result.current.canHint).toBe(true);
    expect(rig.calls).toEqual([]);
  });

  it('records a clean solve as solvedFirstTry with exactly one write', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(blunderRowFixture(), rig);

    act(() => {
      const verdict = result.current.playBoardMove('h5', 'f7');
      expect(verdict).toEqual({ kind: 'solved' });
    });

    expect(result.current.outcome?.result).toBe('solvedFirstTry');
    expect(result.current.outcome?.solved).toBe(true);
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(result.current.exitOutcome()).not.toBeNull();
    expect(rig.calls).toHaveLength(1);
    expect(result.current.wrongMovesTried).toEqual([]);
  });

  it('still records the outcome under React StrictMode (dev double-invoked effects)', async () => {
    // Regression: the mount effect's cleanup sets `cancelledRef` true; StrictMode
    // runs setup → cleanup → setup in development, so the ref must be reset on
    // the second setup or `doRecord` bails and the write never completes.
    const row = blunderRowFixture();
    const rig = createRecorderRig();
    const { result } = renderHook(
      () =>
        usePuzzleSolve({
          row,
          context: cycleContextFixture('fixture:cycle', `${row.sourceGameId}:${row.sourcePly}`, 1),
          config: solveConfigFixture(),
          recorder: rig.recorder,
          now: () => NOW,
        }),
      { wrapper: StrictMode },
    );

    act(() => {
      result.current.playBoardMove('h5', 'f7');
    });

    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(result.current.exitOutcome()).not.toBeNull();
    expect(rig.calls).toHaveLength(1);
  });

  it('records solvedWithHelp for a hint-then-clean-solve (no wrong move) with one write', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(puzzleRowFixture('mate-one'), rig);

    act(() => result.current.revealHint());
    expect(result.current.hintCount).toBe(1);
    expect(result.current.outcome).toBeNull();
    expect(result.current.stage).toBe('solving');

    act(() => {
      const verdict = result.current.playBoardMove('h5', 'f7');
      expect(verdict).toEqual({ kind: 'solved' });
    });
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(result.current.outcome?.result).toBe('solvedWithHelp');
    expect(result.current.outcome?.solved).toBe(true);
    expect(rig.calls).toHaveLength(1);
  });

  it('records the FIRST wrong move as an immediate failed attempt while staying in solving (fail-once)', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(blunderRowFixture(), rig);

    act(() => {
      expect(result.current.playBoardMove('d2', 'd3')).toEqual({ kind: 'wrong' });
    });
    // The board stays at the decision point and the presentation is NOT ended.
    expect(result.current.wrongMoveCount).toBe(1);
    expect(result.current.wrongMovesTried).toEqual(['d2d3']);
    expect(result.current.playedLine).toEqual([]);
    expect(result.current.viewPly).toBe(0);
    expect(result.current.atDecisionPoint).toBe(true);
    expect(result.current.stage).toBe('solving');
    expect(result.current.outcome?.result).toBe('failed');
    expect(result.current.outcome?.solved).toBe(false);
    expect(result.current.foundAfterFail).toBe(false);

    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(rig.calls).toHaveLength(1);
    expect(rig.calls[0]?.trigger).toBe('wrongMove');
    expect(rig.calls[0]?.counters.wrongMoveCount).toBe(1);
    // Hints stay usable after the fail (the line is empty again).
    expect(result.current.canHint).toBe(true);

    // A second wrong move never writes a second row.
    act(() => {
      expect(result.current.playBoardMove('a2', 'a3')).toEqual({ kind: 'wrong' });
    });
    expect(result.current.wrongMoveCount).toBe(2);
    expect(rig.calls).toHaveLength(1);
    expect(result.current.stage).toBe('solving');
  });

  it('a correct solve AFTER a wrong-fail writes nothing more, marks foundAfterFail and keeps the failed outcome', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(puzzleRowFixture('mate-one'), rig);

    act(() => {
      expect(result.current.playBoardMove('d2', 'd3')).toEqual({ kind: 'wrong' });
    });
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(rig.calls).toHaveLength(1);

    act(() => {
      const verdict = result.current.playBoardMove('h5', 'f7');
      expect(verdict).toEqual({ kind: 'solved' });
    });
    expect(result.current.foundAfterFail).toBe(true);
    expect(result.current.outcome?.result).toBe('failed');
    expect(result.current.stage).toBe('outcome');
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    // Exactly one attempt row was written — the recorded outcome stays failed.
    expect(rig.calls).toHaveLength(1);
    expect(result.current.exitOutcome()?.result).toBe('failed');
    expect(result.current.playedLine).toEqual(['h5f7']);
  });

  it('give-up after a wrong-fail ends the presentation without a second write', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(puzzleRowFixture('mate-one'), rig);

    act(() => {
      expect(result.current.playBoardMove('d2', 'd3')).toEqual({ kind: 'wrong' });
    });
    await waitFor(() => expect(result.current.writePhase).toBe('written'));

    act(() => result.current.giveUp());
    expect(result.current.stage).toBe('postSolve');
    expect(result.current.outcome?.result).toBe('failed');
    expect(rig.calls).toHaveLength(1);
    expect(result.current.exitOutcome()?.result).toBe('failed');
  });

  it('skip after a wrong-fail closes the view without a second write', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(puzzleRowFixture('mate-one'), rig);

    act(() => {
      expect(result.current.playBoardMove('d2', 'd3')).toEqual({ kind: 'wrong' });
    });
    await waitFor(() => expect(result.current.writePhase).toBe('written'));

    act(() => result.current.skip());
    expect(result.current.stage).toBe('outcome');
    expect(result.current.outcome?.result).toBe('failed');
    expect(rig.calls).toHaveLength(1);
  });

  it('rejects an illegal move submission as illegal: not counted, nothing written', () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(blunderRowFixture(), rig);

    act(() => {
      expect(result.current.playBoardMove('e2', 'e5')).toEqual({ kind: 'illegal' });
    });
    expect(result.current.wrongMoveCount).toBe(0);
    expect(result.current.wrongMovesTried).toEqual([]);
    expect(rig.calls).toEqual([]);
  });

  it('reveals hints one level per press from the visible level 2, gates off after level 4, and restart clears reveal content but keeps counters', async () => {
    const rig = createRecorderRig();
    const row = puzzleRowFixture('mate-two');
    const { result } = renderSolve(row, rig);

    act(() => result.current.revealHint());
    expect(result.current.hintCount).toBe(1);
    expect(result.current.highestHintLevel).toBe(2);
    expect(result.current.revealedHintLevels).toEqual([2]);
    expect(result.current.canHint).toBe(true);

    act(() => result.current.revealHint());
    act(() => result.current.revealHint());
    expect(result.current.revealedHintLevels).toEqual([2, 3, 4]);
    expect(result.current.canHint).toBe(false);
    act(() => result.current.revealHint());
    expect(result.current.hintCount).toBe(3);

    act(() => result.current.restart());
    expect(result.current.revealedHintLevels).toEqual([]);
    expect(result.current.playedLine).toEqual([]);
    expect(result.current.hintCount).toBe(3);
    expect(result.current.wrongMoveCount).toBe(0);
    expect(rig.calls).toEqual([]);
  });

  it('solves a tactical terminal accepted alternative on its first move', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(terminalAlternativeRowFixture(), rig);

    act(() => {
      expect(result.current.playBoardMove('g5', 'e6')).toEqual({ kind: 'solved' });
    });
    expect(result.current.outcome?.result).toBe('solvedFirstTry');
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(rig.calls).toHaveLength(1);
  });

  it('walks a multi-move line with auto-played replies and only accepts moves at the decision point', async () => {
    const rig = createRecorderRig();
    const row = puzzleRowFixture('mate-two');
    const { result } = renderSolve(row, rig);

    act(() => {
      expect(result.current.playBoardMove('b8', 'b6')).toEqual({ kind: 'accepted' });
    });
    expect(result.current.playedLine).toEqual(['b8b6', 'g1f1']);
    expect(result.current.viewPly).toBe(2);
    expect(result.current.atDecisionPoint).toBe(true);

    // Viewing an earlier ply is view-only: a move there is ignored (R-10).
    act(() => result.current.goToPly('first'));
    expect(result.current.viewPly).toBe(0);
    expect(result.current.atDecisionPoint).toBe(false);
    act(() => {
      expect(result.current.playBoardMove('b6', 'f2')).toEqual({ kind: 'ignored' });
    });
    act(() => result.current.goToPly('end'));
    expect(result.current.atDecisionPoint).toBe(true);

    act(() => {
      expect(result.current.playBoardMove('b6', 'f2')).toEqual({ kind: 'solved' });
    });
    expect(result.current.playedLine).toEqual(['b8b6', 'g1f1', 'b6f2']);
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(rig.calls).toHaveLength(1);
  });

  it('skip ends the presentation as skipped and never opens the post-solve step', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(puzzleRowFixture('mate-one'), rig);

    act(() => result.current.skip());
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(result.current.outcome?.result).toBe('skipped');
    expect(result.current.outcome?.solved).toBe(false);
    expect(result.current.stage).toBe('outcome');
    expect(result.current.exitOutcome()?.result).toBe('skipped');
    expect(rig.calls).toHaveLength(1);
  });

  it('give-up records failed and auto-opens the post-solve step once written', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(puzzleRowFixture('mate-one'), rig);

    act(() => result.current.giveUp());
    expect(result.current.stage).toBe('outcome');
    expect(result.current.outcome?.result).toBe('failed');
    await waitFor(() => expect(result.current.stage).toBe('postSolve'));
    expect(result.current.writePhase).toBe('written');
    expect(rig.calls).toHaveLength(1);
  });

  it('keeps a failed write on the outcome screen with an inline error and retry, never advancing an unwritten row', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(puzzleRowFixture('mate-one'), rig);

    rig.failNextWrite();
    act(() => result.current.giveUp());
    await waitFor(() => expect(result.current.writePhase).toBe('retryable'));
    expect(result.current.writeError).toContain('Failed to persist puzzle attempt');
    expect(result.current.outcome?.result).toBe('failed');
    // The outcome summary is visible but the host cannot advance yet.
    expect(result.current.exitOutcome()).toBeNull();
    expect(rig.calls).toHaveLength(1);

    act(() => result.current.retryWrite());
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(rig.calls).toHaveLength(2);
    expect(result.current.exitOutcome()).not.toBeNull();
  });

  it('discards nothing on a successful exit (outcome preserved) and exposes no outcome before a trigger', () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(blunderRowFixture(), rig);
    expect(result.current.outcome).toBeNull();
    expect(result.current.exitOutcome()).toBeNull();
    expect(result.current.writePhase).toBeNull();
  });
});
