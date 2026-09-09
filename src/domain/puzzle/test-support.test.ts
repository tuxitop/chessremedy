import { describe, expect, it } from 'vitest';
import { walkLine } from '@/domain/tactics';
import { assembleBlunderPuzzle, assemblePuzzle } from './assemble';
import {
  PUZZLE_FIXTURE_KINDS,
  puzzleFixture,
  puzzleRowFixture,
  PUZZLE_FIXTURE_NOW,
  blunderPuzzleInputFixture,
  blunderRowFixture,
} from './test-support';

describe('puzzle fixtures', () => {
  it('covers every deterministic fixture kind (AC #9)', () => {
    expect([...PUZZLE_FIXTURE_KINDS].sort()).toEqual([
      'accepted-alternatives',
      'exchange-win',
      'mate-one',
      'mate-two',
      'material-combination',
      'missed-opportunity',
      'multi-move-combination',
    ]);
  });

  it('replays every candidate bestPv legally from its starting FEN (no engine)', () => {
    for (const kind of PUZZLE_FIXTURE_KINDS) {
      const candidate = puzzleFixture(kind);
      const walked = walkLine(candidate.startingFen, candidate.bestPv);
      expect(walked.ok, `${kind}: ${walked.ok ? '' : walked.message}`).toBe(true);
    }
  });

  it('assembles puzzleRowFixture(kind) === assemblePuzzle(puzzleFixture(kind))', () => {
    for (const kind of PUZZLE_FIXTURE_KINDS) {
      expect(assemblePuzzle(puzzleFixture(kind), PUZZLE_FIXTURE_NOW)).toEqual(
        puzzleRowFixture(kind),
      );
    }
  });

  it('gives every kind a legal first-ply solution length matching bestPv', () => {
    for (const kind of PUZZLE_FIXTURE_KINDS) {
      const candidate = puzzleFixture(kind);
      expect(candidate.candidateSolutionLength).toBe(candidate.bestPv.length);
    }
  });

  it('spreads difficulty across more than one bucket', () => {
    const difficulties = PUZZLE_FIXTURE_KINDS.map((kind) => puzzleFixture(kind).difficulty);
    expect(new Set(difficulties).size).toBeGreaterThan(1);
    for (const d of difficulties) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(100);
    }
  });

  it('assembles the blunder fixture legally and deterministically', () => {
    const input = blunderPuzzleInputFixture('correct-move');
    const walked = walkLine(input.startingFen, [input.bestMove]);
    expect(walked.ok, walked.ok ? '' : walked.message).toBe(true);
    expect(blunderRowFixture('correct-move')).toEqual(
      assembleBlunderPuzzle(input, PUZZLE_FIXTURE_NOW),
    );
  });
});
