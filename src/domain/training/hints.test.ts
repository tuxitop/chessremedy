import { describe, expect, it } from 'vitest';
import { parsePositionFen, type Position } from '@/domain/chess/position';
import {
  PUZZLE_FIXTURE_NOW,
  blunderRowFixture,
  puzzleRowFixture,
} from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { applyMove, beginPresentation, positionAtPly } from './solve';
import type { PresentationState } from './solve';
import { trainingRowFixture } from './test-support';
import type { HintLevel, SolveHintConfig } from './types';
import { hintContent, nextHintLevel, revealNextHint } from './hints';

function startPosition(row: PuzzleRow): Position {
  const parsed = parsePositionFen(row.startingFen);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return parsed.position;
}

function beginState(row: PuzzleRow): PresentationState {
  const result = beginPresentation(row, PUZZLE_FIXTURE_NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.state;
}

function config(partial: Partial<SolveHintConfig>): SolveHintConfig {
  return { enabledLevels: [1, 2, 3, 4], firstHintLevel: 1, ...partial };
}

function revealAll(state: PresentationState, cfg: SolveHintConfig): PresentationState {
  let current = state;
  for (;;) {
    const result = revealNextHint(current, cfg);
    if (!result.ok) {
      return current;
    }
    current = result.state;
  }
}

describe('nextHintLevel', () => {
  it('ascends from the first hint level through level 4', () => {
    const cfg = config({});
    expect(nextHintLevel(null, cfg)).toBe(1);
    expect(nextHintLevel(1, cfg)).toBe(2);
    expect(nextHintLevel(2, cfg)).toBe(3);
    expect(nextHintLevel(3, cfg)).toBe(4);
    expect(nextHintLevel(4, cfg)).toBeNull();
  });

  it('starts at the configured first-hint threshold', () => {
    const cfg = config({ firstHintLevel: 3 });
    expect(nextHintLevel(null, cfg)).toBe(3);
    expect(nextHintLevel(3, cfg)).toBe(4);
    expect(nextHintLevel(4, cfg)).toBeNull();
  });

  it('skips disabled levels', () => {
    const cfg = config({ enabledLevels: [1, 3, 4] });
    expect(nextHintLevel(null, cfg)).toBe(1);
    expect(nextHintLevel(1, cfg)).toBe(3);
    expect(nextHintLevel(3, cfg)).toBe(4);
    expect(nextHintLevel(4, cfg)).toBeNull();
  });

  it('combines the threshold with disabled levels', () => {
    const cfg = config({ firstHintLevel: 2, enabledLevels: [2, 4] });
    expect(nextHintLevel(null, cfg)).toBe(2);
    expect(nextHintLevel(2, cfg)).toBe(4);
    expect(nextHintLevel(4, cfg)).toBeNull();
  });

  it('returns null when no enabled level remains at or above the threshold', () => {
    expect(nextHintLevel(null, config({ enabledLevels: [] }))).toBeNull();
    expect(nextHintLevel(4, config({}))).toBeNull();
  });
});

describe('hintContent', () => {
  it('reveals exactly the PRODUCT §10 content for each level (tactical row)', () => {
    const row = puzzleRowFixture('mate-one');
    const position = startPosition(row);

    const l1 = hintContent(1, row, position);
    expect(l1).toEqual({
      ok: true,
      content: { level: 1, text: 'Relevant piece: queen', squares: [] },
    });

    const l2 = hintContent(2, row, position);
    expect(l2.ok).toBe(true);
    if (l2.ok) {
      expect(l2.content).toEqual({ level: 2, text: 'The piece is on h5', squares: ['h5'] });
    }

    const l3 = hintContent(3, row, position);
    expect(l3.ok).toBe(true);
    if (l3.ok) {
      expect(l3.content).toEqual({ level: 3, text: 'Move it to f7', squares: ['f7'] });
    }

    const l4 = hintContent(4, row, position);
    expect(l4.ok).toBe(true);
    if (l4.ok) {
      expect(l4.content).toEqual({
        level: 4,
        text: 'Qxf7#',
        squares: ['h5', 'f7'],
      });
    }
  });

  it('gives a blunder row the same first-move-only content', () => {
    const row = blunderRowFixture('correct-move');
    const l4 = hintContent(4, row, startPosition(row));
    expect(l4.ok && l4.content.text).toBe('Qxf7#');
  });

  it('renders castling as its king move SAN (O-O)', () => {
    const row = trainingRowFixture('castling');
    const l4 = hintContent(4, row, startPosition(row));
    expect(l4.ok).toBe(true);
    if (l4.ok) {
      expect(l4.content).toEqual({ level: 4, text: 'O-O', squares: ['e1', 'g1'] });
    }
  });

  it('renders an en-passant capture as its SAN', () => {
    const row = trainingRowFixture('en-passant');
    const l4 = hintContent(4, row, startPosition(row));
    expect(l4.ok).toBe(true);
    if (l4.ok) {
      expect(l4.content).toEqual({ level: 4, text: 'exf6', squares: ['e5', 'f6'] });
    }
  });

  it('renders a promotion as its full SAN move', () => {
    const row = trainingRowFixture('promotion');
    const l4 = hintContent(4, row, startPosition(row));
    expect(l4.ok).toBe(true);
    if (l4.ok) {
      expect(l4.content.text).toBe('c8=Q+');
      expect(l4.content.squares).toEqual(['c7', 'c8']);
    }
  });

  it('returns an error result when bestMove is not legal at the given position', () => {
    const row = puzzleRowFixture('mate-two');
    const moved = applyMove(beginState(row), 'b8b6');
    expect(moved.kind).toBe('accepted');
    if (moved.kind !== 'accepted') {
      throw new Error('unreachable');
    }
    const decision = positionAtPly(moved.state, moved.state.line.length);
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      throw new Error('unreachable');
    }
    // bestMove (b8b6) is already played — no longer legal at this branch point.
    const result = hintContent(1, row, decision.position);
    expect(result.ok).toBe(false);
  });
});

describe('revealNextHint', () => {
  it('advances one level per press, recording counters and content', () => {
    const cfg = config({});
    let state = beginState(puzzleRowFixture('mate-one'));

    const first = revealNextHint(state, cfg);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('unreachable');
    }
    expect(first.level).toBe(1);
    state = first.state;
    expect(state.hintCount).toBe(1);
    expect(state.highestHintLevel).toBe(1);
    expect(state.revealedHintLevels).toEqual([1]);
    expect(state.wrongMoveCount).toBe(0);

    const second = revealNextHint(state, cfg);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error('unreachable');
    }
    expect(second.level).toBe(2);
    expect(second.state.revealedHintLevels).toEqual([1, 2]);
  });

  it('stops once every enabled level is revealed', () => {
    const state = revealAll(beginState(puzzleRowFixture('mate-one')), config({}));
    expect(state.hintCount).toBe(4);
    expect(state.highestHintLevel).toBe(4);
    expect(state.revealedHintLevels).toEqual([1, 2, 3, 4]);
    const result = revealNextHint(state, config({}));
    expect(result).toMatchObject({ ok: false, reason: 'no-further-level' });
  });

  it('never reveals beyond level 4', () => {
    const state = revealAll(beginState(puzzleRowFixture('mate-one')), config({}));
    expect(state.revealedHintLevels).toEqual([1, 2, 3, 4]);
  });

  it('is gated off once the first solution move has been solved', () => {
    const row = puzzleRowFixture('material-combination');
    let state = beginState(row);
    const revealed = revealNextHint(state, config({}));
    expect(revealed.ok).toBe(true);
    state = revealed.ok ? revealed.state : state;

    const moved = applyMove(state, 'g5f7');
    expect(moved.kind).toBe('accepted');
    if (moved.kind !== 'accepted') {
      throw new Error('unreachable');
    }
    const result = revealNextHint(moved.state, config({}));
    expect(result).toMatchObject({ ok: false, reason: 'first-move-solved' });
    expect(result.state.hintCount).toBe(1);
  });

  it('respects disabled levels and the configured threshold', () => {
    const cfg = config({ firstHintLevel: 2, enabledLevels: [2, 4] });
    const state = revealAll(beginState(puzzleRowFixture('mate-one')), cfg);
    expect(state.revealedHintLevels).toEqual([2, 4]);
    expect(state.highestHintLevel).toBe(4);
  });
});

describe('hint level types', () => {
  it('keeps the level vocabulary at the PRODUCT §10 range', () => {
    const levels: readonly HintLevel[] = [1, 2, 3, 4];
    expect(levels).toEqual([1, 2, 3, 4]);
  });
});
