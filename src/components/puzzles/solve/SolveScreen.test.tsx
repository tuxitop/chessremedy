import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { puzzleRowFixture, blunderRowFixture } from '@/domain/puzzle/test-support';
import { buildAttemptRow } from '@/domain/training';

import type { PuzzleRow } from '@/domain/puzzle';
import type { PresentationOutcome } from '@/domain/training';
import type { PuzzleAttemptRecorderLike, RecordAttemptInput } from '@/infrastructure/training';
import { PuzzleAttemptWriteError } from '@/infrastructure/training';
import {
  solveConfigFixture,
  cycleContextFixture,
  trainingRowFixture,
} from '@/domain/training/test-support';
import { SolveScreen } from './SolveScreen';

const { chessboardProps } = vi.hoisted(() => ({
  chessboardProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/chessboard/Chessboard', () => ({
  Chessboard: (props: Record<string, unknown>) => {
    chessboardProps.push(props);
    return null;
  },
}));

interface Rig {
  readonly recorder: PuzzleAttemptRecorderLike;
  readonly calls: RecordAttemptInput[];
  setFailing(value: boolean): void;
}

function createRig(): Rig {
  const calls: RecordAttemptInput[] = [];
  let failing = false;
  const recorder: PuzzleAttemptRecorderLike = {
    async record(input) {
      calls.push(input);
      if (failing) {
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
    setFailing(value) {
      failing = value;
    },
  };
}

function renderSolve(
  row: PuzzleRow,
  rig: Rig,
  onExit: (outcome: PresentationOutcome | null) => void,
) {
  render(
    <SolveScreen
      row={row}
      context={cycleContextFixture('fixture:cycle', `${row.sourceGameId}:${row.sourcePly}`, 1)}
      config={solveConfigFixture()}
      recorder={rig.recorder}
      onExit={onExit}
    />,
  );
}

function lastBoard(): Record<string, unknown> {
  const last = chessboardProps[chessboardProps.length - 1];
  if (!last) {
    throw new Error('No Chessboard has rendered.');
  }
  return last;
}

function boardMove(from: string, to: string): void {
  const props = lastBoard();
  const onMove = props.onMove as ((f: string, t: string) => void) | undefined;
  if (!onMove) {
    throw new Error('Board is not interactive.');
  }
  act(() => onMove(from, to));
}

function typeAndPlayMove(text: string): void {
  fireEvent.change(screen.getByLabelText('Enter a move'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('puzzle-move-submit'));
}

describe('SolveScreen (Feature 012, Stage D)', () => {
  beforeEach(() => {
    chessboardProps.length = 0;
  });

  it('presents a tactical origin fresh: starting board, orientation, objective label, no difficulty, zero counters', () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    expect(screen.getByTestId('solve-objective')).toHaveTextContent('Forced mate');
    expect(screen.getByTestId('solve-side-to-move')).toHaveTextContent('White to move');
    expect(screen.queryByText(/Trivial|Medium|Hard|Master/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('solve-wrong-count')).toHaveTextContent('Wrong moves: 0');
    expect(screen.getByTestId('solve-hint-count')).toHaveTextContent('Hints used: 0');
    expect(screen.getByTestId('solve-clock')).toHaveTextContent('0:00');
    expect(screen.getByLabelText('Enter a move')).not.toBeDisabled();

    const board = lastBoard();
    expect(board.orientation).toBe('white');
    expect(board.interactive).toBe(true);
    expect(board.position).toBeDefined();
    expect(rig.calls).toEqual([]);
  });

  it('presents a blunder origin with its fixed correct-move objective', () => {
    const rig = createRig();
    renderSolve(blunderRowFixture(), rig, () => undefined);
    expect(screen.getByTestId('solve-objective')).toHaveTextContent('Find the best move');
    expect(rig.calls).toEqual([]);
  });

  it('solves a blunder via the board and writes one attempt row before continuing to the host', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(blunderRowFixture(), rig, onExit);

    boardMove('h5', 'f7');

    await waitFor(() => expect(screen.getByTestId('outcome-panel')).toBeInTheDocument());
    expect(screen.getByTestId('outcome-announcement')).toHaveTextContent('Solved on the first try');
    expect(screen.getByTestId('outcome-result')).toHaveTextContent('Solved on the first try');
    expect(screen.getByTestId('outcome-wrong-moves')).toHaveTextContent('0');
    await waitFor(() => expect(screen.getByTestId('outcome-continue')).toBeEnabled());
    expect(rig.calls).toHaveLength(1);

    fireEvent.click(screen.getByTestId('outcome-continue'));
    expect(onExit).toHaveBeenCalledTimes(1);
    const outcome = onExit.mock.calls[0]![0] as PresentationOutcome | null;
    expect(outcome?.result).toBe('solvedFirstTry');
    expect(outcome?.attemptRow).toBeDefined();
  });

  it('identifies a wrong board move (marker + announcement), returns to the decision point, and solves after retry', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(puzzleRowFixture('mate-one'), rig, onExit);

    boardMove('d2', 'd3');

    expect(screen.getByTestId('solve-announcement')).toHaveTextContent(
      'not the move that achieves',
    );
    expect(screen.getByTestId('solve-wrong-count')).toHaveTextContent('Wrong moves: 1');
    expect(screen.getByLabelText('Enter a move')).not.toBeDisabled();
    const shapes = lastBoard().autoShapes as Array<{ brush: string }>;
    expect(shapes.some((shape) => shape.brush === 'red')).toBe(true);
    expect(rig.calls).toEqual([]);

    typeAndPlayMove('h5f7');
    await waitFor(() => expect(screen.getByTestId('outcome-panel')).toBeInTheDocument());
    expect(screen.getByTestId('outcome-result')).toHaveTextContent('Solved with help');
    expect(screen.getByTestId('outcome-wrong-moves')).toHaveTextContent('1');
    await waitFor(() => expect(screen.getByTestId('outcome-continue')).toBeEnabled());
    expect(rig.calls).toHaveLength(1);
  });

  it('reveals hints one level per press with PRODUCT content and highlights, and restart clears them but keeps counters', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    fireEvent.click(screen.getByTestId('solve-hint'));
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent('Relevant piece: queen');
    expect(screen.getByTestId('solve-hint-list')).toHaveTextContent('Relevant piece: queen');

    // Level 1 reveals only the piece type; level 2 adds the square highlight.
    fireEvent.click(screen.getByTestId('solve-hint'));
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent('The piece is on h5');
    const afterSecondHint = lastBoard().autoShapes as Array<{ orig: string; brush: string }>;
    expect(afterSecondHint.some((shape) => shape.brush === 'yellow' && shape.orig === 'h5')).toBe(
      true,
    );
    expect(screen.getByTestId('solve-hint-count')).toHaveTextContent('Hints used: 2');

    fireEvent.click(screen.getByTestId('solve-restart'));
    expect(screen.queryByTestId('solve-hint-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('solve-hint-count')).toHaveTextContent('Hints used: 2');
    expect(screen.getByTestId('solve-wrong-count')).toHaveTextContent('Wrong moves: 0');
    expect(rig.calls).toEqual([]);
  });

  it('navigates the current presentation line only, gating move entry away from the decision point', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(puzzleRowFixture('mate-two'), rig, onExit);

    typeAndPlayMove('b8b6');
    expect(screen.getByTestId('solve-hint-count')).toHaveTextContent('Hints used: 0');

    fireEvent.click(screen.getByTestId('nav-first'));
    expect(lastBoard().interactive).toBe(false);
    expect(screen.getByLabelText('Enter a move')).toBeDisabled();

    fireEvent.click(screen.getByTestId('nav-last'));
    expect(lastBoard().interactive).toBe(true);
    expect(screen.getByLabelText('Enter a move')).not.toBeDisabled();

    typeAndPlayMove('b6f2');
    await waitFor(() => expect(screen.getByTestId('outcome-panel')).toBeInTheDocument());
    expect(screen.getByTestId('outcome-result')).toHaveTextContent('Solved on the first try');
    expect(rig.calls).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('outcome-continue')).toBeEnabled());
  });

  it('opens the engine-free post-solve step from Analyze on a solved outcome and keeps the outcome on continue', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(puzzleRowFixture('mate-one'), rig, onExit);

    typeAndPlayMove('h5f7');
    await waitFor(() => expect(screen.getByTestId('outcome-panel')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('outcome-analyze')).toBeEnabled());

    fireEvent.click(screen.getByTestId('outcome-analyze'));
    expect(screen.getByTestId('post-solve-panel')).toBeInTheDocument();
    expect(screen.getByTestId('post-solve-result')).toHaveTextContent('Solved on the first try');

    fireEvent.click(screen.getByTestId('post-solve-continue'));
    const outcome = onExit.mock.calls[0]![0] as PresentationOutcome | null;
    expect(outcome?.result).toBe('solvedFirstTry');
    expect(rig.calls).toHaveLength(1);
  });

  it('skip ends as skipped with no analyze and no post-solve step, then returns the outcome to the host', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(puzzleRowFixture('mate-one'), rig, onExit);

    fireEvent.click(screen.getByTestId('solve-skip'));

    await waitFor(() => expect(screen.getByTestId('outcome-panel')).toBeInTheDocument());
    expect(screen.getByTestId('outcome-result')).toHaveTextContent('Skipped');
    expect(screen.queryByTestId('outcome-analyze')).not.toBeInTheDocument();
    expect(screen.queryByTestId('post-solve-panel')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('outcome-continue')).toBeEnabled());

    fireEvent.click(screen.getByTestId('outcome-continue'));
    const outcome = onExit.mock.calls[0]![0] as PresentationOutcome | null;
    expect(outcome?.result).toBe('skipped');
    expect(rig.calls).toHaveLength(1);
  });

  it('give-up opens the engine-free post-solve step automatically once the failed row is written', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(puzzleRowFixture('mate-one'), rig, onExit);

    fireEvent.click(screen.getByTestId('solve-give-up'));

    await waitFor(() => expect(screen.getByTestId('post-solve-panel')).toBeInTheDocument());
    expect(screen.getByTestId('post-solve-result')).toHaveTextContent('Gave up');
    expect(screen.getByTestId('post-solution-text')).toBeInTheDocument();
    expect(rig.calls).toHaveLength(1);

    fireEvent.click(screen.getByTestId('post-solve-continue'));
    const outcome = onExit.mock.calls[0]![0] as PresentationOutcome | null;
    expect(outcome?.result).toBe('failed');
  });

  it('keeps a failed write on the outcome screen with an inline error and never advances an unwritten row', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(puzzleRowFixture('mate-one'), rig, onExit);
    rig.setFailing(true);

    fireEvent.click(screen.getByTestId('solve-give-up'));

    await waitFor(() => expect(screen.getByTestId('outcome-write-error')).toBeInTheDocument());
    expect(screen.getByTestId('outcome-write-error')).toHaveTextContent('Failed to persist');
    expect(screen.getByTestId('outcome-result')).toHaveTextContent('Gave up');
    expect(screen.getByTestId('outcome-continue')).toBeDisabled();

    rig.setFailing(false);
    fireEvent.click(screen.getByTestId('outcome-retry-write'));

    // The retried write lands, the row is no longer unwritten, and the failed
    // outcome's post-solve step opens automatically.
    await waitFor(() => expect(screen.getByTestId('post-solve-panel')).toBeInTheDocument());
    expect(rig.calls).toHaveLength(2);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('resolves a pawn promotion through the promotion dialog', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(trainingRowFixture('promotion'), rig, onExit);

    // Board path: a pawn reaching the back rank triggers the promotion dialog.
    const props = lastBoard();
    const onPromotion = props.onPromotionRequired as
      ((p: { from: string; to: string }) => void) | undefined;
    if (!onPromotion) {
      throw new Error('Board must support promotion.');
    }
    act(() => onPromotion({ from: 'c7', to: 'c8' }));
    expect(screen.getByTestId('promotion-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('promotion-queen'));

    await waitFor(() => expect(screen.getByTestId('outcome-panel')).toBeInTheDocument());
    expect(screen.getByTestId('outcome-result')).toHaveTextContent('Solved on the first try');
    await waitFor(() => expect(screen.getByTestId('outcome-continue')).toBeEnabled());
    expect(rig.calls).toHaveLength(1);
  });

  it('solves a terminal accepted alternative on its first move and writes one row', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(puzzleRowFixture('accepted-alternatives'), rig, onExit);

    typeAndPlayMove('g5e6');

    await waitFor(() => expect(screen.getByTestId('outcome-panel')).toBeInTheDocument());
    expect(screen.getByTestId('outcome-result')).toHaveTextContent('Solved on the first try');
    await waitFor(() => expect(screen.getByTestId('outcome-continue')).toBeEnabled());
    expect(rig.calls).toHaveLength(1);

    fireEvent.click(screen.getByTestId('outcome-continue'));
    const outcome = onExit.mock.calls[0]![0] as PresentationOutcome | null;
    expect(outcome?.result).toBe('solvedFirstTry');
  });

  it('solves a promotion from the pointer-free text entry', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(trainingRowFixture('promotion'), rig, onExit);

    typeAndPlayMove('c7c8q');

    await waitFor(() => expect(screen.getByTestId('outcome-panel')).toBeInTheDocument());
    expect(screen.getByTestId('outcome-result')).toHaveTextContent('Solved on the first try');
    await waitFor(() => expect(screen.getByTestId('outcome-continue')).toBeEnabled());
    expect(rig.calls).toHaveLength(1);
    expect(onExit).not.toHaveBeenCalled();
  });
});
