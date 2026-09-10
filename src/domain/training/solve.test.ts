import { describe, expect, it } from 'vitest';
import { fenOf, type Position } from '@/domain/chess/position';
import {
  PUZZLE_FIXTURE_NOW,
  blunderRowFixture,
  puzzleRowFixture,
} from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { DEFAULT_SOLVE_HINT_CONFIG, revealNextHint } from './hints';
import {
  acceptedMovesOf,
  applyMove,
  beginPresentation,
  playedLine,
  positionAtPly,
  presentationSolved,
  restartPresentation,
} from './solve';
import type { PresentationState } from './solve';
import { trainingRowFixture } from './test-support';

const NOW = PUZZLE_FIXTURE_NOW;

function beginState(row: PuzzleRow): PresentationState {
  const result = beginPresentation(row, NOW);
  expect(result.ok, result.ok ? '' : result.message).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.state;
}

function acceptedMove(state: PresentationState, uci: string): PresentationState {
  const result = applyMove(state, uci);
  expect(result.kind).toBe('accepted');
  return result.state;
}

function wrongMove(state: PresentationState, uci: string): PresentationState {
  const result = applyMove(state, uci);
  expect(result.kind).toBe('wrong');
  return result.state;
}

function decisionPosition(state: PresentationState): Position {
  const result = positionAtPly(state, state.line.length);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.position;
}

/** A legacy-style tactical row: no `origin`, no `acceptedFirstMoves` field. */
function legacyTacticalRow(): PuzzleRow {
  const { acceptedFirstMoves: _accepted, origin: _origin, ...row } = puzzleRowFixture('mate-two');
  return row;
}

function corruptRow(overrides: Partial<PuzzleRow>): PuzzleRow {
  return { ...puzzleRowFixture('mate-one'), ...overrides };
}

describe('acceptedMovesOf', () => {
  it('accepts exactly the single bestMove of a blunder row', () => {
    const accepted = acceptedMovesOf(blunderRowFixture('correct-move'));
    expect(accepted.has('h5f7')).toBe(true);
    expect(accepted.size).toBe(1);
  });

  it('unions bestMove and acceptedFirstMoves for a tactical row', () => {
    const accepted = acceptedMovesOf(puzzleRowFixture('accepted-alternatives'));
    expect(accepted).toEqual(new Set(['g5f7', 'g5e6']));
  });

  it('defaults to {bestMove} when acceptedFirstMoves is absent', () => {
    const accepted = acceptedMovesOf(legacyTacticalRow());
    expect(accepted).toEqual(new Set(['b8b6']));
  });
});

describe('beginPresentation', () => {
  it('builds a fresh presentation over the row', () => {
    const row = puzzleRowFixture('mate-two');
    const state = beginState(row);
    expect(state.row).toBe(row);
    expect(state.startedAt).toBe(NOW);
    expect(state.line).toEqual([]);
    expect(state.wrongMovesTried).toEqual([]);
    expect(state.wrongMoveCount).toBe(0);
    expect(state.hintCount).toBe(0);
    expect(state.highestHintLevel).toBeNull();
    expect(state.revealedHintLevels).toEqual([]);
    expect(presentationSolved(state)).toBe(false);
  });

  it('rejects an unparseable startingFen as a typed failure', () => {
    const result = beginPresentation(corruptRow({ startingFen: 'not a fen' }), NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a solution line that does not replay from the startingFen', () => {
    const result = beginPresentation(corruptRow({ bestPv: ['h5f7', 'zzzz'] }), NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a blunder row whose bestPv is not the singleton [bestMove]', () => {
    const result = beginPresentation(
      corruptRow({ origin: 'blunder', bestPv: ['h5f7', 'h5h7'] }),
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a tactical row whose bestPv does not start with bestMove', () => {
    const result = beginPresentation(corruptRow({ bestPv: ['d2d3', 'h5f7'] }), NOW);
    expect(result.ok).toBe(false);
  });

  it('accepts the legacy row shape (origin absent) as a normal tactical presentation', () => {
    expect(beginPresentation(legacyTacticalRow(), NOW).ok).toBe(true);
  });
});

describe('applyMove — tactical single-move and blunder rows', () => {
  it('solves a one-move tactical row with bestMove', () => {
    const state = acceptedMove(beginState(puzzleRowFixture('mate-one')), 'h5f7');
    expect(presentationSolved(state)).toBe(true);
    expect(playedLine(state)).toEqual(['h5f7']);
  });

  it('rejects a wrong move: counted, remembered, and never in the line', () => {
    let state = beginState(puzzleRowFixture('mate-one'));
    const before = fenOf(decisionPosition(state));
    state = wrongMove(state, 'd2d3');
    expect(state.wrongMoveCount).toBe(1);
    expect(state.wrongMovesTried).toEqual(['d2d3']);
    expect(playedLine(state)).toEqual([]);
    expect(presentationSolved(state)).toBe(false);
    // The board returns to the decision point (position unchanged).
    expect(fenOf(decisionPosition(state))).toBe(before);
    state = acceptedMove(state, 'h5f7');
    expect(presentationSolved(state)).toBe(true);
  });

  it('solves a blunder row only on its single bestMove', () => {
    const row = blunderRowFixture('correct-move');
    expect(acceptedMovesOf(row).size).toBe(1);
    const solved = acceptedMove(beginState(row), 'h5f7');
    expect(presentationSolved(solved)).toBe(true);
    expect(playedLine(solved)).toEqual(['h5f7']);
  });

  it('treats the historical user move of a blunder row as an ordinary wrong move', () => {
    const row = blunderRowFixture('correct-move');
    const state = wrongMove(beginState(row), row.userMovePlayed);
    expect(state.wrongMoveCount).toBe(1);
    expect(playedLine(state)).toEqual([]);
  });

  it('has no wrong-move limit', () => {
    let state = beginState(puzzleRowFixture('mate-one'));
    for (const uci of ['d2d3', 'a2a3', 'h2h3']) {
      state = wrongMove(state, uci);
    }
    expect(state.wrongMoveCount).toBe(3);
    expect(state.wrongMovesTried).toEqual(['d2d3', 'a2a3', 'h2h3']);
    state = acceptedMove(state, 'h5f7');
    expect(presentationSolved(state)).toBe(true);
  });
});

describe('applyMove — multi-move continuation', () => {
  it('auto-plays the opponent reply and requires the branch moves in order', () => {
    const row = puzzleRowFixture('material-combination');
    let state = beginState(row);
    expect(acceptedMovesOf(row)).toEqual(new Set(['g5f7']));

    state = acceptedMove(state, 'g5f7');
    expect(presentationSolved(state)).toBe(false);
    expect(playedLine(state)).toEqual(['g5f7', 'd8e7']);

    state = acceptedMove(state, 'f7h8');
    expect(presentationSolved(state)).toBe(true);
    expect(playedLine(state)).toEqual(['g5f7', 'd8e7', 'f7h8']);
  });

  it('rejects a deviation after an accepted first move as a wrong branch', () => {
    const row = puzzleRowFixture('material-combination');
    let state = acceptedMove(beginState(row), 'g5f7');
    const before = playedLine(state);
    state = wrongMove(state, 'd2d4');
    expect(state.wrongMoveCount).toBe(1);
    expect(playedLine(state)).toEqual(before);
    expect(presentationSolved(state)).toBe(false);
    state = acceptedMove(state, 'f7h8');
    expect(presentationSolved(state)).toBe(true);
  });

  it('marks solved only when every user token of the branch is played', () => {
    let state = beginState(puzzleRowFixture('mate-two'));
    state = acceptedMove(state, 'b8b6');
    expect(presentationSolved(state)).toBe(false);
    expect(playedLine(state)).toEqual(['b8b6', 'g1f1']);
    state = acceptedMove(state, 'b6f2');
    expect(presentationSolved(state)).toBe(true);
  });
});

describe('applyMove — accepted alternatives and terminal completion', () => {
  const row = puzzleRowFixture('accepted-alternatives');

  it('solves on an accepted alternative with no stored continuation', () => {
    const state = acceptedMove(beginState(row), 'g5e6');
    expect(presentationSolved(state)).toBe(true);
    expect(playedLine(state)).toEqual(['g5e6']);
  });

  it('still walks the bestMove branch to completion for the same row', () => {
    let state = acceptedMove(beginState(row), 'g5f7');
    expect(presentationSolved(state)).toBe(false);
    expect(playedLine(state)).toEqual(['g5f7', 'd8e7']);
    state = acceptedMove(state, 'f7h8');
    expect(presentationSolved(state)).toBe(true);
  });
});

describe('applyMove — canonical UCI comparison', () => {
  it('matches a promotion move only with its exact promotion piece', () => {
    const state0 = acceptedMove(beginState(trainingRowFixture('promotion')), 'c7c8q');
    expect(presentationSolved(state0)).toBe(true);
    expect(playedLine(state0)).toEqual(['c7c8q']);

    const wrong = wrongMove(beginState(trainingRowFixture('promotion')), 'c7c8r');
    expect(wrong.wrongMoveCount).toBe(1);

    const illegal = applyMove(beginState(trainingRowFixture('promotion')), 'c7c8');
    expect(illegal.kind).toBe('illegal');
    expect(illegal.state.wrongMoveCount).toBe(0);
  });

  it('compares an en-passant capture by its canonical capture token', () => {
    const solved = acceptedMove(beginState(trainingRowFixture('en-passant')), 'e5f6');
    expect(presentationSolved(solved)).toBe(true);
    const wrong = wrongMove(beginState(trainingRowFixture('en-passant')), 'e5e6');
    expect(wrong.wrongMoveCount).toBe(1);
  });

  it('compares castling by the canonical king two-square token and auto-plays the reply', () => {
    const solved = acceptedMove(beginState(trainingRowFixture('castling')), 'e1g1');
    expect(presentationSolved(solved)).toBe(true);
    expect(playedLine(solved)).toEqual(['e1g1', 'e8e7']);

    // The king-to-rook-square spelling is the same legal O-O move.
    const altSpelling = acceptedMove(beginState(trainingRowFixture('castling')), 'e1h1');
    expect(presentationSolved(altSpelling)).toBe(true);

    const wrong = wrongMove(beginState(trainingRowFixture('castling')), 'e1c1');
    expect(wrong.wrongMoveCount).toBe(1);
    const quietWrong = wrongMove(beginState(trainingRowFixture('castling')), 'e1e2');
    expect(quietWrong.wrongMoveCount).toBe(1);
  });
});

describe('applyMove — guards', () => {
  it('rejects an illegal move without counting it as wrong', () => {
    const state = beginState(puzzleRowFixture('mate-one'));
    const result = applyMove(state, 'a1a8');
    expect(result.kind).toBe('illegal');
    expect(result.state.wrongMoveCount).toBe(0);
    expect(playedLine(result.state)).toEqual([]);
  });

  it('rejects a malformed UCI token', () => {
    const result = applyMove(beginState(puzzleRowFixture('mate-one')), 'not-a-move');
    expect(result.kind).toBe('illegal');
    expect(result.state.wrongMoveCount).toBe(0);
  });

  it('rejects moves once the presentation is solved', () => {
    const solved = acceptedMove(beginState(puzzleRowFixture('mate-one')), 'h5f7');
    const result = applyMove(solved, 'd2d3');
    expect(result.kind).toBe('illegal');
    expect(result.state).toBe(solved);
  });
});

describe('restartPresentation', () => {
  it('clears the line and revealed hint content but keeps counters and clock', () => {
    let state = beginState(puzzleRowFixture('mate-two'));
    state = wrongMove(state, 'b8e8');
    const hintResult = revealNextHint(state, DEFAULT_SOLVE_HINT_CONFIG);
    expect(hintResult.ok).toBe(true);
    if (!hintResult.ok) {
      throw new Error('unreachable');
    }
    state = hintResult.state;
    expect(state.hintCount).toBe(1);

    state = restartPresentation(state);
    expect(state.line).toEqual([]);
    expect(state.revealedHintLevels).toEqual([]);
    expect(state.wrongMoveCount).toBe(1);
    expect(state.wrongMovesTried).toEqual(['b8e8']);
    expect(state.hintCount).toBe(1);
    expect(state.highestHintLevel).toBe(2);
    expect(state.startedAt).toBe(NOW);

    // The board is back at the first decision point and solvable again.
    state = acceptedMove(state, 'b8b6');
    expect(presentationSolved(state)).toBe(false);
    state = acceptedMove(state, 'b6f2');
    expect(presentationSolved(state)).toBe(true);
  });
});

describe('position transport', () => {
  it('replays the played line at any ply', () => {
    const state = acceptedMove(
      acceptedMove(beginState(puzzleRowFixture('material-combination')), 'g5f7'),
      'f7h8',
    );
    expect(playedLine(state)).toEqual(['g5f7', 'd8e7', 'f7h8']);

    const atPly = (ply: number) => {
      const result = positionAtPly(state, ply);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.position;
    };
    // The user is always the mover at the start; sides alternate per token.
    expect(atPly(0).turn).toBe('white');
    expect(atPly(1).turn).toBe('black');
    expect(atPly(2).turn).toBe('white');
    expect(atPly(3).turn).toBe('black');

    const end = positionAtPly(state, state.line.length);
    expect(end.ok).toBe(true);
    for (const bad of [-1, 4, 1.5]) {
      const result = positionAtPly(state, bad);
      expect(result.ok).toBe(false);
    }
  });
});
