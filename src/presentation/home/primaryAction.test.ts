/**
 * Feature 018 — `selectHomePrimaryAction` selector tests (deterministic, no DOM).
 */

import { describe, expect, it } from 'vitest';
import type { HomeContinueTarget } from './continue';
import { selectHomePrimaryAction } from './primaryAction';

const none: HomeContinueTarget = { kind: 'none' };

describe('selectHomePrimaryAction', () => {
  it('returns null while the game count is unknown and no target exists', () => {
    expect(
      selectHomePrimaryAction({
        totalGames: null,
        hasEligibleAnalysis: false,
        continueTarget: none,
      }),
    ).toBeNull();
  });

  it('selects import when no games are stored', () => {
    expect(
      selectHomePrimaryAction({
        totalGames: 0,
        hasEligibleAnalysis: false,
        continueTarget: none,
      }),
    ).toEqual({ kind: 'import', label: 'Import your games', target: { to: 'games' } });
  });

  it('selects analyze when games exist without an eligible analysis', () => {
    expect(
      selectHomePrimaryAction({
        totalGames: 5,
        hasEligibleAnalysis: false,
        continueTarget: none,
      }),
    ).toEqual({ kind: 'analyze', label: 'Analyze a game', target: { to: 'games' } });
  });

  it('selects statistics when games are analyzed with no continue target', () => {
    expect(
      selectHomePrimaryAction({
        totalGames: 5,
        hasEligibleAnalysis: true,
        continueTarget: none,
      }),
    ).toEqual({ kind: 'statistics', label: 'View your statistics', target: { to: 'statistics' } });
  });

  it('selects continue for a cycle target', () => {
    const continueTarget: HomeContinueTarget = {
      kind: 'cycle',
      setId: 'set-1',
      cycleNumber: 3,
      label: 'Rapid review',
      quickTrain: false,
    };
    expect(
      selectHomePrimaryAction({ totalGames: 5, hasEligibleAnalysis: true, continueTarget }),
    ).toEqual({
      kind: 'continue',
      label: 'Continue training',
      target: { to: 'cycle', setId: 'set-1', cycleNumber: 3 },
    });
  });

  it('selects continue for a block or set target', () => {
    const block: HomeContinueTarget = { kind: 'block', setId: 'block-1', label: 'Block' };
    const set: HomeContinueTarget = { kind: 'set', setId: 'set-1', label: 'Set' };

    expect(
      selectHomePrimaryAction({ totalGames: 5, hasEligibleAnalysis: true, continueTarget: block }),
    ).toEqual({
      kind: 'continue',
      label: 'Continue training',
      target: { to: 'set', setId: 'block-1' },
    });
    expect(
      selectHomePrimaryAction({ totalGames: 5, hasEligibleAnalysis: true, continueTarget: set }),
    ).toEqual({
      kind: 'continue',
      label: 'Continue training',
      target: { to: 'set', setId: 'set-1' },
    });
  });

  it('lets a continue target win while the game count is unknown', () => {
    const continueTarget: HomeContinueTarget = {
      kind: 'cycle',
      setId: 'set-1',
      cycleNumber: 1,
      label: 'Quick train',
      quickTrain: true,
    };
    expect(
      selectHomePrimaryAction({ totalGames: null, hasEligibleAnalysis: false, continueTarget }),
    ).toEqual({
      kind: 'continue',
      label: 'Continue training',
      target: { to: 'cycle', setId: 'set-1', cycleNumber: 1 },
    });
  });
});
