import { describe, expect, it } from 'vitest';
import { GAME_PHASE_VERSION, gamePhaseOf } from './gamePhase';
import { parsePositionFen } from './position';

function phaseOf(fen: string): string {
  const parsed = parsePositionFen(fen);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return gamePhaseOf(parsed.position);
}

describe('game phase (specs/domain/game-phase.md V1)', () => {
  it('pins the version', () => {
    expect(GAME_PHASE_VERSION).toBe(1);
  });

  it('classifies the first 12 full moves as opening regardless of material', () => {
    expect(phaseOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe('opening');
    expect(phaseOf('4k3/8/8/8/8/8/4K3/8 w - - 0 12')).toBe('opening');
  });

  it('treats full move 13 with full material as middlegame', () => {
    expect(phaseOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 13')).toBe('middlegame');
  });

  it('keeps a side with four minors or a queen in the middlegame', () => {
    // Both sides still hold their four minors (bishops + knights).
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 13';
    expect(phaseOf(fen)).toBe('middlegame');
    // A lone queen keeps it middlegame even after the opening.
    expect(phaseOf('4k3/8/8/8/8/8/2Q5/4K3 w - - 0 20')).toBe('middlegame');
  });

  it('reaches the endgame only when both sides lack queens and minors', () => {
    // K+R vs K: no queens, no minors.
    expect(phaseOf('4k3/8/8/8/8/8/2R5/4K3 w - - 0 20')).toBe('endgame');
    // K+two knights vs K: 2 minors each side ≤ 3, no queen → endgame.
    expect(phaseOf('4k3/8/8/8/8/8/2NN4/4K3 w - - 0 20')).toBe('endgame');
  });
});
