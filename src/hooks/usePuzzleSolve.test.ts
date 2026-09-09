import { describe, expect, it } from 'vitest';
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
      const verdict = result.current.submitTextMove('h5f7');
      expect(verdict).toEqual({ kind: 'solved' });
    });

    expect(result.current.outcome?.result).toBe('solvedFirstTry');
    expect(result.current.outcome?.solved).toBe(true);
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(result.current.exitOutcome()).not.toBeNull();
    expect(rig.calls).toHaveLength(1);
    expect(result.current.wrongMovesTried).toEqual([]);
  });

  it('keeps a wrong move out of the line, counts it, and records a help solve', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(blunderRowFixture(), rig);

    act(() => {
      expect(result.current.submitTextMove('d2d3')).toEqual({ kind: 'wrong' });
    });
    expect(result.current.wrongMoveCount).toBe(1);
    expect(result.current.wrongMovesTried).toEqual(['d2d3']);
    expect(result.current.playedLine).toEqual([]);
    expect(result.current.viewPly).toBe(0);
    expect(result.current.atDecisionPoint).toBe(true);

    act(() => {
      result.current.submitTextMove('h5f7');
    });
    await waitFor(() => expect(result.current.writePhase).toBe('written'));
    expect(result.current.outcome?.result).toBe('solvedWithHelp');
    expect(result.current.outcome?.wrongMoveCount).toBe(1);
    expect(rig.calls).toHaveLength(1);
  });

  it('treats an illegal text entry as illegal: not counted, nothing written', () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(blunderRowFixture(), rig);

    act(() => {
      expect(result.current.submitTextMove('e2e5')).toEqual({ kind: 'illegal' });
    });
    expect(result.current.wrongMoveCount).toBe(0);
    expect(result.current.wrongMovesTried).toEqual([]);
    expect(rig.calls).toEqual([]);
  });

  it('reveals hints one level per press, gates off after level 4, and restart clears reveal content but keeps counters', async () => {
    const rig = createRecorderRig();
    const row = puzzleRowFixture('mate-two');
    const { result } = renderSolve(row, rig);

    act(() => result.current.revealHint());
    expect(result.current.hintCount).toBe(1);
    expect(result.current.highestHintLevel).toBe(1);
    expect(result.current.revealedHintLevels).toEqual([1]);
    expect(result.current.canHint).toBe(true);

    act(() => result.current.revealHint());
    act(() => result.current.revealHint());
    act(() => result.current.revealHint());
    expect(result.current.revealedHintLevels).toEqual([1, 2, 3, 4]);
    expect(result.current.canHint).toBe(false);
    act(() => result.current.revealHint());
    expect(result.current.hintCount).toBe(4);

    act(() => result.current.restart());
    expect(result.current.revealedHintLevels).toEqual([]);
    expect(result.current.playedLine).toEqual([]);
    expect(result.current.hintCount).toBe(4);
    expect(result.current.wrongMoveCount).toBe(0);
    expect(rig.calls).toEqual([]);
  });

  it('solves a tactical terminal accepted alternative on its first move', async () => {
    const rig = createRecorderRig();
    const { result } = renderSolve(terminalAlternativeRowFixture(), rig);

    act(() => {
      expect(result.current.submitTextMove('g5e6')).toEqual({ kind: 'solved' });
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
      expect(result.current.submitTextMove('b8b6')).toEqual({ kind: 'accepted' });
    });
    expect(result.current.playedLine).toEqual(['b8b6', 'g1f1']);
    expect(result.current.viewPly).toBe(2);
    expect(result.current.atDecisionPoint).toBe(true);

    // Viewing an earlier ply is view-only: a move there is ignored (R-10).
    act(() => result.current.goToPly('first'));
    expect(result.current.viewPly).toBe(0);
    expect(result.current.atDecisionPoint).toBe(false);
    act(() => {
      expect(result.current.submitTextMove('b6f2')).toEqual({ kind: 'ignored' });
    });
    act(() => result.current.goToPly('end'));
    expect(result.current.atDecisionPoint).toBe(true);

    act(() => {
      expect(result.current.submitTextMove('b6f2')).toEqual({ kind: 'solved' });
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
