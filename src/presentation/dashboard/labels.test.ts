import { describe, expect, it } from 'vitest';
import {
  ERROR_METRIC_LABELS,
  PHASE_LABELS,
  PLATFORM_LABELS,
  TIME_CONTROL_LABELS,
  partitionLabel,
  weakestCategoryLabel,
} from './labels';

describe('labels', () => {
  it('labels concrete and all-dimension partitions', () => {
    expect(partitionLabel('lichess', 'rapid')).toBe('Lichess · Rapid');
    expect(partitionLabel('chesscom', 'blitz')).toBe('Chess.com · Blitz');
    expect(partitionLabel('all', 'all')).toBe('All platforms · All time controls');
  });

  it('keeps the canonical platform and time-control order', () => {
    expect(PLATFORM_LABELS.lichess).toBe('Lichess');
    expect(PLATFORM_LABELS.chesscom).toBe('Chess.com');
    expect(TIME_CONTROL_LABELS.correspondence).toBe('Correspondence');
    expect(TIME_CONTROL_LABELS.unknown).toBe('Other');
  });

  it('labels every phase', () => {
    expect(PHASE_LABELS).toEqual({
      opening: 'Opening',
      middlegame: 'Middlegame',
      endgame: 'Endgame',
    });
  });

  it('labels every error metric', () => {
    expect(Object.keys(ERROR_METRIC_LABELS)).toEqual([
      'inaccuracies',
      'mistakes',
      'blunders',
      'missedTactics',
      'inaccuraciesPerGame',
      'mistakesPerGame',
      'blundersPerGame',
      'missedTacticsPerGame',
    ]);
    expect(ERROR_METRIC_LABELS.missedTacticsPerGame).toBe('Missed tactics per game');
  });

  it('reuses the canonical objective and blunder labels for weakest categories', () => {
    expect(weakestCategoryLabel('winning_material')).toBe('Winning material');
    expect(weakestCategoryLabel('forcing_mate')).toBe('Forced mate');
    expect(weakestCategoryLabel('blunder')).toBe('Find the best move');
  });
});
