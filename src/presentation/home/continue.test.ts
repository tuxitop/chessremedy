/**
 * Feature 018 — `resolveHomeContinue` selector tests (deterministic, no DOM).
 */

import { describe, expect, it } from 'vitest';
import { QUICK_TRAIN_SET_ID, REVIEW_SET_ID } from '@/domain/training/autoSet';
import { blockSetFixture, cycleFixture, setFixture } from '@/domain/training/test-support';
import { resolveHomeContinue } from './continue';

const NOW = 1_700_000_000_000;

describe('resolveHomeContinue', () => {
  it('picks the most recently started inProgress cycle', () => {
    const set = setFixture({ id: 'set-1', name: 'Rapid review' });
    const older = cycleFixture({
      id: 'cycle-a',
      trainingSetId: 'set-1',
      cycleNumber: 1,
      status: 'inProgress',
      startedAt: NOW - 1000,
    });
    const newer = cycleFixture({
      id: 'cycle-b',
      trainingSetId: 'set-1',
      cycleNumber: 2,
      status: 'inProgress',
      startedAt: NOW,
    });

    const target = resolveHomeContinue({ sets: [set], openBlock: null, cycles: [older, newer] });

    expect(target).toEqual({
      kind: 'cycle',
      setId: 'set-1',
      cycleNumber: 2,
      label: 'Rapid review',
      quickTrain: false,
    });
  });

  it('breaks a startedAt tie by greater cycle number, then cycleId ascending', () => {
    const set = setFixture({ id: 'set-1' });
    const low = cycleFixture({
      id: 'cycle-a',
      trainingSetId: 'set-1',
      cycleNumber: 1,
      status: 'inProgress',
      startedAt: NOW,
    });
    const high = cycleFixture({
      id: 'cycle-z',
      trainingSetId: 'set-1',
      cycleNumber: 3,
      status: 'inProgress',
      startedAt: NOW,
    });
    const sameNumberA = cycleFixture({
      id: 'cycle-b',
      trainingSetId: 'set-1',
      cycleNumber: 2,
      status: 'inProgress',
      startedAt: NOW,
    });
    const sameNumberB = cycleFixture({
      id: 'cycle-c',
      trainingSetId: 'set-1',
      cycleNumber: 2,
      status: 'inProgress',
      startedAt: NOW,
    });

    const target = resolveHomeContinue({
      sets: [set],
      openBlock: null,
      cycles: [low, sameNumberB, high, sameNumberA],
    });

    expect(target.kind).toBe('cycle');
    if (target.kind === 'cycle') {
      expect(target.cycleNumber).toBe(3);
      expect(target.setId).toBe('set-1');
    }
  });

  it('never picks abandoned or completed cycles', () => {
    const set = setFixture({ id: 'set-1' });
    const abandoned = cycleFixture({
      id: 'cycle-a',
      trainingSetId: 'set-1',
      status: 'abandoned',
      startedAt: NOW,
    });
    const completed = cycleFixture({
      id: 'cycle-b',
      trainingSetId: 'set-1',
      status: 'completed',
      startedAt: NOW + 10,
    });

    const target = resolveHomeContinue({
      sets: [set],
      openBlock: null,
      cycles: [abandoned, completed],
    });

    expect(target).toEqual({ kind: 'set', setId: 'set-1', label: 'Fixture set' });
  });

  it('falls through to the open block when no cycle is in progress', () => {
    const set = setFixture({ id: 'set-1' });
    const block = blockSetFixture({ id: 'block-1', name: 'Woodpecker block' });
    const completed = cycleFixture({ id: 'cycle-a', status: 'completed', startedAt: NOW });

    const target = resolveHomeContinue({
      sets: [set],
      openBlock: block,
      cycles: [completed],
    });

    expect(target).toEqual({ kind: 'block', setId: 'block-1', label: 'Woodpecker block' });
  });

  it('falls through to the most recently active custom set', () => {
    const older = setFixture({ id: 'set-a', name: 'Old set', updatedAt: NOW - 5000 });
    const newer = setFixture({ id: 'set-b', name: 'New set', updatedAt: NOW });
    const block = blockSetFixture({ id: 'block-1' });

    const target = resolveHomeContinue({
      sets: [older, newer, block],
      openBlock: null,
      cycles: [],
    });

    expect(target).toEqual({ kind: 'set', setId: 'set-b', label: 'New set' });
  });

  it('prefers an active custom set over a more recently updated archived set', () => {
    const active = setFixture({ id: 'set-active', status: 'active', updatedAt: NOW - 10_000 });
    const archived = setFixture({ id: 'set-archived', status: 'archived', updatedAt: NOW });

    const target = resolveHomeContinue({ sets: [active, archived], openBlock: null, cycles: [] });

    expect(target).toEqual({ kind: 'set', setId: 'set-active', label: 'Fixture set' });
  });

  it('returns none with no cycle, block or custom set', () => {
    const block = blockSetFixture({ id: 'block-1' });
    const target = resolveHomeContinue({ sets: [block], openBlock: null, cycles: [] });
    expect(target).toEqual({ kind: 'none' });
  });

  it('surfaces a Quick-train cycle as "Quick train" without a set row', () => {
    const cycle = cycleFixture({
      id: 'quick-cycle',
      trainingSetId: QUICK_TRAIN_SET_ID,
      cycleNumber: 4,
      status: 'inProgress',
      startedAt: NOW,
    });

    const target = resolveHomeContinue({ sets: [], openBlock: null, cycles: [cycle] });

    expect(target).toEqual({
      kind: 'cycle',
      setId: QUICK_TRAIN_SET_ID,
      cycleNumber: 4,
      label: 'Quick train',
      quickTrain: true,
    });
  });

  it('ignores the reserved review sentinel cycle in favour of a real training cycle', () => {
    const set = setFixture({ id: 'set-1', name: 'Rapid review' });
    const reviewCycle = cycleFixture({
      id: 'review-cycle',
      trainingSetId: REVIEW_SET_ID,
      cycleNumber: 1,
      status: 'inProgress',
      startedAt: NOW,
    });
    const trainingCycle = cycleFixture({
      id: 'training-cycle',
      trainingSetId: 'set-1',
      cycleNumber: 1,
      status: 'inProgress',
      startedAt: NOW - 1000,
    });

    const target = resolveHomeContinue({
      sets: [set],
      openBlock: null,
      cycles: [reviewCycle, trainingCycle],
    });

    expect(target).toEqual({
      kind: 'cycle',
      setId: 'set-1',
      cycleNumber: 1,
      label: 'Rapid review',
      quickTrain: false,
    });
  });

  it('falls through when only a review sentinel cycle is in progress', () => {
    const set = setFixture({ id: 'set-1' });
    const reviewCycle = cycleFixture({
      id: 'review-cycle',
      trainingSetId: REVIEW_SET_ID,
      status: 'inProgress',
      startedAt: NOW,
    });

    const target = resolveHomeContinue({ sets: [set], openBlock: null, cycles: [reviewCycle] });

    expect(target).toEqual({ kind: 'set', setId: 'set-1', label: 'Fixture set' });
  });
});
