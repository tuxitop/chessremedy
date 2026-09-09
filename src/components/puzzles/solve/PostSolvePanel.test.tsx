import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import type { UseBoardSize } from '@/components/chessboard/useBoardSize';
import { puzzleRowFixture, blunderRowFixture } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle';
import { buildAttemptRow, presentationOutcomeOf } from '@/domain/training';
import type { PresentationOutcome } from '@/domain/training';
import { cycleContextFixture } from '@/domain/training/test-support';
import { makeMove } from '@/domain/analysis/test-support';
import { PostSolvePanel, type StoredAnalysisLookup } from './PostSolvePanel';

const { chessboardProps } = vi.hoisted(() => ({
  chessboardProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/chessboard/Chessboard', () => ({
  Chessboard: (props: Record<string, unknown>) => {
    chessboardProps.push(props);
    return null;
  },
}));

function stubBoardSize(): UseBoardSize {
  const noop = (): void => undefined;
  return {
    size: 400,
    dragSize: null,
    isDragging: false,
    isMobile: false,
    beginDrag: noop,
    updateDrag: noop,
    endDrag: noop,
    cancelDrag: noop,
    setSize: noop,
  };
}

function outcomeOf(row: PuzzleRow, trigger: 'solved' | 'gaveUp'): PresentationOutcome {
  return presentationOutcomeOf(
    buildAttemptRow({
      row,
      context: cycleContextFixture('fixture:cycle', `${row.sourceGameId}:${row.sourcePly}`, 1),
      trigger,
      counters: { wrongMoveCount: 1, hintCount: 0, highestHintLevel: null },
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_005_000,
    }),
  );
}

function renderPanel(
  row: PuzzleRow,
  outcome: PresentationOutcome,
  attemptLine: readonly string[],
  wrongMovesTried: readonly string[],
  stored: StoredAnalysisLookup,
) {
  render(
    <PostSolvePanel
      row={row}
      outcome={outcome}
      attemptLine={attemptLine}
      wrongMovesTried={wrongMovesTried}
      storedAnalysis={stored}
      boardSize={stubBoardSize()}
      onContinue={() => undefined}
    />,
  );
}

describe('PostSolvePanel (Feature 012, Stage D)', () => {
  beforeEach(() => {
    chessboardProps.length = 0;
  });

  it('shows a solved tactical line fully marked as matching the verified solution with no divergence', async () => {
    const row = puzzleRowFixture('mate-two');
    renderPanel(row, outcomeOf(row, 'solved'), ['b8b6', 'g1f1', 'b6f2'], [], {
      listForGameAndAnalysis: async () => [],
    });

    const list = screen.getByTestId('post-attempt-list');
    expect(list.children).toHaveLength(3);
    expect(screen.getAllByTestId(/^post-attempt-match-/)).toHaveLength(3);
    for (const match of screen.getAllByTestId(/^post-attempt-match-/)) {
      expect(match).toHaveTextContent('matches the verified solution');
    }
    expect(screen.queryByTestId('post-wrong-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('post-divergence-annotation')).not.toBeInTheDocument();
    expect(screen.getByTestId('post-solution-text')).toHaveTextContent(/Qb6/);
    // No ADR-023 "best" label is ever applied to an in-session solved move.
    expect(screen.queryByText(/Best move/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('post-solve-continue')).toBeEnabled());
  });

  it('marks a solved accepted-alternative as matching and lists the stored accepted first moves', async () => {
    const row = puzzleRowFixture('accepted-alternatives');
    renderPanel(row, outcomeOf(row, 'solved'), ['g5e6'], [], {
      listForGameAndAnalysis: async () => [],
    });

    expect(screen.getByTestId('post-attempt-move-0')).toHaveTextContent(
      'matches the verified solution',
    );
    expect(screen.queryByTestId('post-divergence-annotation')).not.toBeInTheDocument();
    expect(screen.getByTestId('post-solution-alternatives')).toHaveTextContent('Also accepted');
  });

  it('renders the stored-only ADR-023 annotation only where a stored MoveAnalysis for the divergence exists', async () => {
    const row = blunderRowFixture();
    const storedRecord = makeMove(row.sourcePly, {
      gameId: row.sourceGameId,
      analysisId: row.analysisId,
      playedMove: { san: 'd3', uci: 'd2d3' },
      bestMove: { san: 'Qxf7#', uci: 'h5f7' },
      classification: 'blunder',
      evalBefore: { cp: 300, mate: null },
      evalAfter: { cp: -300, mate: null },
    });
    renderPanel(row, outcomeOf(row, 'gaveUp'), [], ['d2d3'], {
      listForGameAndAnalysis: async () => [storedRecord],
    });

    const wrongRow = screen.getByTestId('post-wrong-move-0');
    expect(wrongRow).toHaveTextContent('Your move d3');
    expect(wrongRow).toHaveTextContent('not the move that achieves the objective');
    await waitFor(() =>
      expect(screen.getByTestId('post-divergence-annotation')).toHaveTextContent(
        /Blunder \(\?\?\)/,
      ),
    );
    expect(screen.getByTestId('post-divergence-annotation')).toHaveTextContent(/lost \d+% win/);
    expect(screen.getByTestId('post-divergence-annotation')).toHaveTextContent(
      'the engine preferred Qxf7#',
    );
    // The full stored solution is always shown as the reference.
    expect(screen.getByTestId('post-solution-text')).toHaveTextContent(/Qxf7/);
  });

  it('renders a wrong move without glyphs or eval when no stored record exists (absent data never fabricated)', async () => {
    const row = blunderRowFixture();
    renderPanel(row, outcomeOf(row, 'gaveUp'), [], ['d2d3'], {
      listForGameAndAnalysis: async () => [],
    });

    expect(screen.getByTestId('post-wrong-move-0')).toHaveTextContent(
      'not the move that achieves the objective',
    );
    expect(screen.queryByTestId('post-divergence-annotation')).not.toBeInTheDocument();
    expect(screen.getByTestId('post-solution-text')).toHaveTextContent(/Qxf7/);
  });

  it('lists wrong moves rejected during a failed attempt alongside the single-move blunder solution', async () => {
    const row = blunderRowFixture();
    renderPanel(row, outcomeOf(row, 'gaveUp'), [], ['g2g3', 'd2d3'], {
      listForGameAndAnalysis: async () => [],
    });

    expect(screen.getAllByTestId(/^post-wrong-move-/)).toHaveLength(2);
    expect(screen.getByTestId('post-solution-text')).toBeInTheDocument();
    expect(screen.queryByTestId('post-attempt-section')).not.toBeInTheDocument();
  });

  it('replays the attempt board as read-only and returns via continue', async () => {
    const row = puzzleRowFixture('mate-two');
    const onContinue = vi.fn();
    render(
      <PostSolvePanel
        row={row}
        outcome={outcomeOf(row, 'solved')}
        attemptLine={['b8b6', 'g1f1', 'b6f2']}
        wrongMovesTried={[]}
        storedAnalysis={{ listForGameAndAnalysis: async () => [] }}
        boardSize={stubBoardSize()}
        onContinue={onContinue}
      />,
    );

    const board = chessboardProps[chessboardProps.length - 1]!;
    expect(board.interactive).toBe(false);
    expect(board.orientation).toBe('white');

    // Continue closes the step; the outcome stays preserved in the caller.
    screen.getByTestId('post-solve-continue').click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
