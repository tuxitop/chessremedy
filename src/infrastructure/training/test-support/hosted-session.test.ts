/**
 * Hosted-session harness tests (Feature 012, Stage C).
 *
 * Deterministic, in-memory end-to-end tests over the harness (a stand-in for
 * the Feature-013 host) driving presentations through the Stage-A solver and
 * the real Stage-C recorder over an in-memory fake of the
 * `PuzzleAttemptsRepository` — no IndexedDB, no engine, no network. Covers:
 * a clean solve records exactly one `solvedFirstTry` row; give-up / skip
 * record `failed` / `skipped`; discard-on-exit writes nothing and leaves the
 * puzzle unanswered at the same presentation index; the ordered queue and the
 * retry-failed modes (`immediate` / `endOfCycle`) re-present a failed puzzle
 * with an incremented `presentationIndex` (an additional row, never an
 * overwrite); the config snapshot governs hint levels; a wrong move is counted
 * without failing the puzzle (solve then records `solvedWithHelp`); and a
 * thrown recorder write failure keeps the outcome visible/retryable without the
 * session advancing until a retry write (which throws to the host when it
 * fails again) or an explicit confirm-discard.
 */

import { describe, expect, it } from 'vitest';
import { puzzleIdOf } from '@/domain/puzzle/id';
import { PUZZLE_FIXTURE_NOW, puzzleRowFixture } from '@/domain/puzzle/test-support';
import type { PuzzleRow } from '@/domain/puzzle/types';
import { solveConfigFixture } from '@/domain/training/test-support';
import type { HintLevel } from '@/domain/training/types';
import type { PuzzleAttemptRow } from '@/domain/training/types';
import type { PresentationMoveResult } from '@/domain/training';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import { HostedSession } from './index';
import type { HostedPlayResult, HostedPresentation } from './index';
import { PuzzleAttemptWriteError } from '../attempts-service';

/** The deterministic fixture rows used across the harness tests. */
const MATE_TWO: PuzzleRow = puzzleRowFixture('mate-two');
const EXCHANGE: PuzzleRow = puzzleRowFixture('exchange-win');

/** Narrow a play result to its `move` branch (fails the test otherwise). */
function expectMove(result: HostedPlayResult): PresentationMoveResult {
  if (result.kind !== 'move') {
    throw new Error(`Expected a 'move' play result, got '${result.kind}'.`);
  }
  return result.move;
}

// mate-two solution: b8b6 (Qb6+) then b6f2 after Black's auto-played g1f1.
const MATE_TWO_FIRST = 'b8b6';
const MATE_TWO_LAST = 'b6f2';
const MATE_TWO_WRONG = 'b8b7'; // a legal queen move that is not the solution.
// exchange-win solution: a3d3 (Rxd3). a3b3 is a legal but wrong rook move.
const EXCHANGE_BEST = 'a3d3';
const EXCHANGE_WRONG = 'a3b3';

/** In-memory `PuzzleAttemptsRepository` fake (duplicated locally per suite). */
class FakeAttemptsRepository implements PuzzleAttemptsRepository {
  readonly rows = new Map<string, PuzzleAttemptRow>();
  failNextAdd = false;

  private keyOf(cycleId: string, puzzleId: string, presentationIndex: number): string {
    return `${cycleId}\u0000${puzzleId}\u0000${presentationIndex}`;
  }

  addAttempt(row: PuzzleAttemptRow): Promise<'added' | 'already-present'> {
    const key = this.keyOf(row.cycleId, row.puzzleId, row.presentationIndex);
    if (this.failNextAdd) {
      this.failNextAdd = false;
      return Promise.reject(new Error('simulated persistence failure'));
    }
    if (this.rows.has(key)) {
      return Promise.resolve('already-present');
    }
    this.rows.set(key, row);
    return Promise.resolve('added');
  }

  getAttempt(
    cycleId: string,
    puzzleId: string,
    presentationIndex: number,
  ): Promise<PuzzleAttemptRow | undefined> {
    return Promise.resolve(this.rows.get(this.keyOf(cycleId, puzzleId, presentationIndex)));
  }

  listForCycle(cycleId: string): Promise<PuzzleAttemptRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.cycleId === cycleId));
  }

  listForPuzzle(puzzleId: string): Promise<PuzzleAttemptRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.puzzleId === puzzleId));
  }

  listForCycleAndPuzzle(cycleId: string, puzzleId: string): Promise<PuzzleAttemptRow[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.cycleId === cycleId && row.puzzleId === puzzleId),
    );
  }

  deleteForPuzzleIds(puzzleIds: readonly string[]): Promise<void> {
    const set = new Set(puzzleIds);
    for (const [key, row] of this.rows) {
      if (set.has(row.puzzleId)) {
        this.rows.delete(key);
      }
    }
    return Promise.resolve();
  }

  deleteForTrainingSetIds(trainingSetIds: readonly string[]): Promise<void> {
    const set = new Set(trainingSetIds);
    for (const [key, row] of this.rows) {
      if (set.has(row.trainingSetId)) {
        this.rows.delete(key);
      }
    }
    return Promise.resolve();
  }
}

function begin(host: HostedSession): HostedPresentation {
  const result = host.beginNext();
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.presentation;
}

function puzzleId(row: PuzzleRow): string {
  return puzzleIdOf(row.sourceGameId, row.sourcePly);
}

describe('hosted-session harness', () => {
  it('records exactly one solvedFirstTry row for a clean multi-move solve', async () => {
    const attempts = new FakeAttemptsRepository();
    let now = PUZZLE_FIXTURE_NOW;
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [MATE_TWO],
      config: solveConfigFixture(),
      attempts,
      now: () => now,
      retryFailed: 'none',
    });

    const presentation = begin(host);
    expect(presentation.context.presentationIndex).toBe(1);
    expect(presentation.statusView).toBe('solving');

    now += 1_000;
    const first = expectMove(await presentation.play(MATE_TWO_FIRST));
    expect(first.kind).toBe('accepted');
    if (first.kind === 'accepted') {
      expect(first.solved).toBe(false);
    }

    now += 2_000;
    const solved = await presentation.play(MATE_TWO_LAST);
    expect(solved.kind).toBe('solved');
    if (solved.kind === 'solved') {
      expect(solved.finalization.write?.status).toBe('written');
      expect(solved.finalization.outcome.result).toBe('solvedFirstTry');
      expect(solved.finalization.outcome.solved).toBe(true);
      expect(solved.finalization.outcome.solvingTimeMs).toBe(3_000);
      expect(solved.finalization.outcome.wrongMoveCount).toBe(0);
      expect(solved.finalization.outcome.hintCount).toBe(0);
    }
    expect(presentation.statusView).toBe('ended');

    expect(await host.recordedAttemptCount()).toBe(1);
    const stored = await attempts.getAttempt('fixture:cycle', puzzleId(MATE_TWO), 1);
    expect(stored?.result).toBe('solvedFirstTry');
    expect(stored?.solved).toBe(true);
    expect(stored?.startedAt).toBe(PUZZLE_FIXTURE_NOW);
    expect(host.remaining).toBe(0);
    expect(host.activePresentation).toBeNull();
  });

  it('records failed on give-up and skipped on skip (single-pass mode)', async () => {
    const attempts = new FakeAttemptsRepository();
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [MATE_TWO, EXCHANGE],
      config: solveConfigFixture(),
      attempts,
      retryFailed: 'none',
    });

    const givenUp = begin(host);
    const gaveUp = await givenUp.giveUp();
    expect(gaveUp.ok).toBe(true);
    if (gaveUp.ok) {
      expect(gaveUp.finalization.write?.status).toBe('written');
      expect(gaveUp.finalization.outcome.result).toBe('failed');
      expect(gaveUp.finalization.outcome.solved).toBe(false);
    }

    const skippedPresentation = begin(host);
    const skipped = await skippedPresentation.skip();
    expect(skipped.ok).toBe(true);
    if (skipped.ok) {
      expect(skipped.finalization.outcome.result).toBe('skipped');
    }

    expect(await host.recordedAttemptCount()).toBe(2);
    const failedRow = await attempts.getAttempt('fixture:cycle', puzzleId(MATE_TWO), 1);
    const skippedRow = await attempts.getAttempt('fixture:cycle', puzzleId(EXCHANGE), 1);
    expect(failedRow?.result).toBe('failed');
    expect(skippedRow?.result).toBe('skipped');
    expect(host.remaining).toBe(0);
  });

  it('discard-on-exit writes nothing and re-presents the puzzle unanswered at the same index', async () => {
    const attempts = new FakeAttemptsRepository();
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [MATE_TWO],
      config: solveConfigFixture(),
      attempts,
      retryFailed: 'none',
    });

    const presentation = begin(host);
    const wrong = expectMove(await presentation.play(MATE_TWO_WRONG));
    expect(wrong.kind).toBe('wrong');

    presentation.discard();
    expect(presentation.statusView).toBe('ended');
    expect(await host.recordedAttemptCount()).toBe(0);
    expect(host.remaining).toBe(1);

    // The puzzle is unanswered: re-presented with a fresh state at the same index.
    const again = begin(host);
    expect(again.context.presentationIndex).toBe(1);
    expect(again.solveState.line).toEqual([]);
    expect(again.solveState.wrongMoveCount).toBe(0);
    expect(again.solveState.hintCount).toBe(0);
  });

  it('a wrong move is counted without failing the puzzle; a later solve records solvedWithHelp', async () => {
    const attempts = new FakeAttemptsRepository();
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [EXCHANGE],
      config: solveConfigFixture(),
      attempts,
      retryFailed: 'none',
    });

    const presentation = begin(host);
    const wrong = expectMove(await presentation.play(EXCHANGE_WRONG));
    expect(wrong.kind).toBe('wrong');
    expect(presentation.solveState.wrongMoveCount).toBe(1);

    const hint = presentation.hint();
    expect(hint.ok).toBe(true);

    const solved = await presentation.play(EXCHANGE_BEST);
    expect(solved.kind).toBe('solved');
    if (solved.kind === 'solved') {
      expect(solved.finalization.outcome.result).toBe('solvedWithHelp');
      expect(solved.finalization.outcome.wrongMoveCount).toBe(1);
      expect(solved.finalization.outcome.hintCount).toBe(1);
      expect(solved.finalization.outcome.highestHintLevel).toBe(2);
    }
  });

  it('respects the ordered queue and re-presents a failed puzzle immediately at an incremented index', async () => {
    const attempts = new FakeAttemptsRepository();
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [EXCHANGE, MATE_TWO],
      config: solveConfigFixture(),
      attempts,
      retryFailed: 'immediate',
    });

    // First presentation: EXCHANGE, given up → failed row @ index 1.
    const first = begin(host);
    expect(puzzleId(first.row)).toBe(puzzleId(EXCHANGE));
    await first.giveUp();

    // immediate retry re-presents EXCHANGE at index 2 before MATE_TWO.
    const retry = begin(host);
    expect(puzzleId(retry.row)).toBe(puzzleId(EXCHANGE));
    expect(retry.context.presentationIndex).toBe(2);

    const retriedSolve = await retry.play(EXCHANGE_BEST);
    expect(retriedSolve.kind).toBe('solved');
    if (retriedSolve.kind === 'solved') {
      expect(retriedSolve.finalization.outcome.result).toBe('solvedFirstTry');
    }

    const next = begin(host);
    expect(puzzleId(next.row)).toBe(puzzleId(MATE_TWO));
    expect(next.context.presentationIndex).toBe(1);

    expect(
      host.presented.map((entry) => [entry.puzzleId, entry.context.presentationIndex]),
    ).toEqual([
      [puzzleId(EXCHANGE), 1],
      [puzzleId(EXCHANGE), 2],
      [puzzleId(MATE_TWO), 1],
    ]);

    // The retry pass wrote an ADDITIONAL row (index 2), never an overwrite.
    const rows = await attempts.listForCycleAndPuzzle('fixture:cycle', puzzleId(EXCHANGE));
    expect(rows.map((row) => [row.presentationIndex, row.result])).toEqual([
      [1, 'failed'],
      [2, 'solvedFirstTry'],
    ]);
    // Only the two EXCHANGE presentations were recorded; MATE_TWO is still open.
    expect(await host.recordedAttemptCount()).toBe(2);
  });

  it('endOfCycle retry re-presents a failed puzzle after the remaining queue', async () => {
    const attempts = new FakeAttemptsRepository();
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [EXCHANGE, MATE_TWO],
      config: solveConfigFixture(),
      attempts,
      retryFailed: 'endOfCycle',
    });

    const first = begin(host);
    await first.giveUp();

    const second = begin(host);
    expect(puzzleId(second.row)).toBe(puzzleId(MATE_TWO));
    expect(second.context.presentationIndex).toBe(1);
    await second.skip();

    const third = begin(host);
    expect(puzzleId(third.row)).toBe(puzzleId(EXCHANGE));
    expect(third.context.presentationIndex).toBe(2);

    expect(
      host.presented.map((entry) => [entry.puzzleId, entry.context.presentationIndex]),
    ).toEqual([
      [puzzleId(EXCHANGE), 1],
      [puzzleId(MATE_TWO), 1],
      [puzzleId(EXCHANGE), 2],
    ]);
  });

  it('resolves hints against the session config snapshot', async () => {
    const attempts = new FakeAttemptsRepository();
    const config = { enabledLevels: [3, 4] as HintLevel[], firstHintLevel: 2 as HintLevel };
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [MATE_TWO],
      config,
      attempts,
      retryFailed: 'none',
    });

    const presentation = begin(host);

    // firstHintLevel 2 is disabled, so the first press skips to level 3.
    const first = presentation.hint();
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.level).toBe(3);
    }
    const second = presentation.hint();
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.level).toBe(4);
    }
    const exhausted = presentation.hint();
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) {
      expect(exhausted.reason).toBe('no-further-level');
    }
    expect(presentation.solveState.hintCount).toBe(2);
    expect(presentation.solveState.highestHintLevel).toBe(4);
    expect(presentation.solveState.wrongMoveCount).toBe(0);
  });

  it('holds a thrown write failure visible/retryable without advancing the session', async () => {
    const attempts = new FakeAttemptsRepository();
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [EXCHANGE],
      config: solveConfigFixture(),
      attempts,
      retryFailed: 'none',
    });

    attempts.failNextAdd = true;
    const presentation = begin(host);
    // A recorder throw is caught internally: the session is never corrupted.
    const solved = await presentation.play(EXCHANGE_BEST);
    expect(solved.kind).toBe('solved');
    if (solved.kind === 'solved') {
      expect(solved.finalization.write).toBeNull();
      expect(solved.finalization.error).toBeDefined();
      // The outcome stays visible while the write is pending.
      expect(solved.finalization.outcome.result).toBe('solvedFirstTry');
    }
    expect(presentation.statusView).toBe('retryable');
    expect(await host.recordedAttemptCount()).toBe(0);

    // The session must not advance past an unwritten row.
    expect(host.beginNext().ok).toBe(false);
    expect(host.activePresentation).toBe(presentation);

    // Retrying the write (idempotent) records the row and settles the puzzle.
    const retried = await presentation.retryWrite();
    expect(retried.ok).toBe(true);
    if (retried.ok) {
      expect(retried.finalization.write?.status).toBe('written');
    }
    expect(presentation.statusView).toBe('ended');
    expect(await host.recordedAttemptCount()).toBe(1);
    expect(host.beginNext().ok).toBe(false); // queue is now empty.
  });

  it('a retryWrite that fails again throws to the host and stays retryable', async () => {
    const attempts = new FakeAttemptsRepository();
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [EXCHANGE],
      config: solveConfigFixture(),
      attempts,
      retryFailed: 'none',
    });

    attempts.failNextAdd = true;
    const presentation = begin(host);
    await presentation.play(EXCHANGE_BEST);
    expect(presentation.statusView).toBe('retryable');

    attempts.failNextAdd = true;
    await expect(presentation.retryWrite()).rejects.toThrow(PuzzleAttemptWriteError);
    expect(presentation.statusView).toBe('retryable');
    expect(await host.recordedAttemptCount()).toBe(0);

    // Once the store is healthy again the same frozen snapshot writes.
    const retried = await presentation.retryWrite();
    expect(retried.ok).toBe(true);
    if (retried.ok) {
      expect(retried.finalization.write?.status).toBe('written');
    }
    expect(presentation.statusView).toBe('ended');
    expect(await host.recordedAttemptCount()).toBe(1);
  });

  it('confirm-discard after a failed write leaves the puzzle unanswered', async () => {
    const attempts = new FakeAttemptsRepository();
    const host = new HostedSession({
      cycleId: 'fixture:cycle',
      rows: [EXCHANGE],
      config: solveConfigFixture(),
      attempts,
      retryFailed: 'none',
    });

    attempts.failNextAdd = true;
    const presentation = begin(host);
    const solved = await presentation.play(EXCHANGE_BEST);
    if (solved.kind === 'solved') {
      expect(solved.finalization.write).toBeNull();
      expect(solved.finalization.error).toBeDefined();
    }
    expect(presentation.statusView).toBe('retryable');

    presentation.discard();
    expect(presentation.statusView).toBe('ended');
    expect(await host.recordedAttemptCount()).toBe(0);

    const again = begin(host);
    expect(again.context.presentationIndex).toBe(1);
  });
});
