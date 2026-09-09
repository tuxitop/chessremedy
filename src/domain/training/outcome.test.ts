import { describe, expect, it } from 'vitest';
import {
  PUZZLE_FIXTURE_NOW,
  blunderRowFixture,
  puzzleRowFixture,
} from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { puzzleIdOf } from '@/domain/puzzle/id';
import {
  buildAttemptRow,
  deriveResult,
  presentationOutcomeOf,
  type OutcomeTrigger,
} from './outcome';
import { attemptRowFixture, cycleContextFixture } from './test-support';
import type { PresentationCounters } from './types';

const NOW = PUZZLE_FIXTURE_NOW;

const cleanCounters: PresentationCounters = {
  wrongMoveCount: 0,
  hintCount: 0,
  highestHintLevel: null,
};

function rowWithoutOrigin(): PuzzleRow {
  const { origin: _origin, ...row } = puzzleRowFixture('mate-one');
  return row;
}

function build(
  overrides: {
    trigger?: OutcomeTrigger;
    counters?: PresentationCounters;
    row?: PuzzleRow;
    endedAt?: number;
  } = {},
) {
  const row = overrides.row ?? puzzleRowFixture('mate-one');
  return buildAttemptRow({
    row,
    context: cycleContextFixture('cycle-1', row.sourceGameId, 1),
    trigger: overrides.trigger ?? 'solved',
    counters: overrides.counters ?? cleanCounters,
    startedAt: NOW,
    endedAt: overrides.endedAt ?? NOW + 12_345,
  });
}

describe('deriveResult', () => {
  it('maps the Outcomes table exactly', () => {
    expect(deriveResult('solved', cleanCounters)).toBe('solvedFirstTry');
    expect(deriveResult('solved', { ...cleanCounters, hintCount: 1 })).toBe('solvedWithHelp');
    expect(deriveResult('solved', { ...cleanCounters, wrongMoveCount: 2 })).toBe('solvedWithHelp');
    expect(deriveResult('solved', { ...cleanCounters, hintCount: 1, wrongMoveCount: 2 })).toBe(
      'solvedWithHelp',
    );
    expect(deriveResult('gaveUp', cleanCounters)).toBe('failed');
    expect(deriveResult('skip', cleanCounters)).toBe('skipped');
  });
});

describe('buildAttemptRow', () => {
  it('builds the full immutable row for a clean solve', () => {
    const row = puzzleRowFixture('mate-one');
    const attempt = build({ row });
    expect(attempt).toEqual({
      puzzleId: puzzleIdOf(row.sourceGameId, row.sourcePly),
      trainingSetId: 'fixture:set',
      cycleId: 'cycle-1',
      presentationIndex: 1,
      startedAt: NOW,
      endedAt: NOW + 12_345,
      result: 'solvedFirstTry',
      solvingTimeMs: 12_345,
      wrongMoveCount: 0,
      hintCount: 0,
      highestHintLevel: null,
      solved: true,
      puzzleGeneratorVersion: row.puzzleGeneratorVersion,
      origin: 'tactical',
    });
  });

  it('records solvedWithHelp with the highest hint level after a hint solve', () => {
    const attempt = build({ counters: { wrongMoveCount: 0, hintCount: 2, highestHintLevel: 3 } });
    expect(attempt.result).toBe('solvedWithHelp');
    expect(attempt.hintCount).toBe(2);
    expect(attempt.highestHintLevel).toBe(3);
    expect(attempt.solved).toBe(true);
  });

  it('marks gave-up as failed and skip as skipped (not solved)', () => {
    const failed = build({ trigger: 'gaveUp', counters: { ...cleanCounters, wrongMoveCount: 4 } });
    expect(failed.result).toBe('failed');
    expect(failed.solved).toBe(false);
    expect(failed.wrongMoveCount).toBe(4);

    const skipped = build({ trigger: 'skip' });
    expect(skipped.result).toBe('skipped');
    expect(skipped.solved).toBe(false);
  });

  it('copies the blunder origin onto the attempt row', () => {
    const row = blunderRowFixture('correct-move');
    const attempt = build({ row });
    expect(attempt.origin).toBe('blunder');
    expect(attempt.puzzleGeneratorVersion).toBe(row.puzzleGeneratorVersion);
  });

  it('normalizes an absent pre-v2 origin to tactical', () => {
    const row = rowWithoutOrigin();
    const attempt = build({ row });
    expect(attempt.origin).toBe('tactical');
    expect(attempt.puzzleId).toBe(puzzleIdOf(row.sourceGameId, row.sourcePly));
  });

  it('clamps solving time at 0 when the clock is skewed', () => {
    const attempt = build({ endedAt: NOW - 100 });
    expect(attempt.solvingTimeMs).toBe(0);
  });
});

describe('presentationOutcomeOf', () => {
  it('wraps the written row with its summary', () => {
    const row = puzzleRowFixture('mate-one');
    const attempt = build({ row });
    const outcome = presentationOutcomeOf(attempt);
    expect(outcome.attemptRow).toBe(attempt);
    expect(outcome.result).toBe(attempt.result);
    expect(outcome.solvingTimeMs).toBe(attempt.solvingTimeMs);
    expect(outcome.wrongMoveCount).toBe(attempt.wrongMoveCount);
    expect(outcome.hintCount).toBe(attempt.hintCount);
    expect(outcome.highestHintLevel).toBe(attempt.highestHintLevel);
    expect(outcome.solved).toBe(attempt.solved);
  });
});

describe('attemptRowFixture', () => {
  it('produces a deterministic solvedFirstTry row by default', () => {
    const attempt = attemptRowFixture();
    expect(attempt.result).toBe('solvedFirstTry');
    expect(attempt.cycleId).toBe('fixture:cycle');
    expect(attempt.presentationIndex).toBe(1);
    expect(attempt.solvingTimeMs).toBe(5_000);
    expect(attempt.startedAt).toBe(NOW);
    expect(attempt.endedAt).toBe(NOW + 5_000);
  });

  it('honors overrides for stage C/D row-shaping', () => {
    const attempt = attemptRowFixture({
      trigger: 'skip',
      context: cycleContextFixture('cycle-2', 'fixture:mate-two', 2),
    });
    expect(attempt.cycleId).toBe('cycle-2');
    expect(attempt.presentationIndex).toBe(2);
    expect(attempt.result).toBe('skipped');
    expect(attempt.solved).toBe(false);
  });
});
