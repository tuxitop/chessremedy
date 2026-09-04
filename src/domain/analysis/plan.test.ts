import { describe, expect, it } from 'vitest';
import { fixtureGame } from '@/domain/chess/fixtures';
import { gameFromPgn } from '@/domain/chess/parseGame';
import { planGameAnalysis } from './plan';

describe('planGameAnalysis (position extraction)', () => {
  it('plans every mainline ply with ordered plies and legal-move counts', () => {
    const game = fixtureGame('cc-bullet-blunder'); // 1.f3 e5 2.g4?? Qh4# 0-1
    const result = planGameAnalysis(game);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { plan } = result;
    expect(plan.moves).toHaveLength(4);
    plan.moves.forEach((move, index) => {
      expect(move.ply).toBe(index);
    });
    expect(plan.moves[0]!.side).toBe('white');
    expect(plan.moves[1]!.side).toBe('black');
    expect(plan.moves[0]!.moveNumber).toBe(1);
    expect(plan.moves[2]!.moveNumber).toBe(2);
    expect(plan.moves[0]!.playedMove).toEqual({ san: 'f3', uci: 'f2f3' });
    // A fresh start position offers White exactly 20 legal moves.
    expect(plan.moves[0]!.legalMovesCount).toBe(20);
    expect(plan.moves[0]!.gamePhase).toBe('opening');
  });

  it('chains fenBefore/fenAfter across plies and skips the terminal last position', () => {
    const game = fixtureGame('cc-bullet-blunder');
    const result = planGameAnalysis(game);
    if (!result.ok) throw new Error(result.message);
    const { plan } = result;
    for (let i = 1; i < plan.moves.length; i += 1) {
      expect(plan.moves[i]!.positionFen).toBe(plan.moves[i - 1]!.fenAfter);
    }
    // The final Qh4# lands on a terminal position: it is never submitted.
    expect(plan.moves[3]!.terminalAfter).toBe(true);
    expect(plan.moves[2]!.terminalAfter).toBe(false);
    // analyzeFens covers each position before a move and the final position.
    expect(plan.analyzeFens).toHaveLength(4);
    expect(plan.analyzeFens[0]).toBe(plan.moves[0]!.positionFen);
  });

  it('deduplicates repeated positions (transpositions/repetitions)', () => {
    const game = fixtureGame('local-fen-endgame'); // kings repeat: Kd3 Kd5 Ke3 Ke5 …
    const result = planGameAnalysis(game);
    if (!result.ok) throw new Error(result.message);
    const { plan } = result;
    expect(plan.moves.length).toBeGreaterThan(2);
    expect(new Set(plan.analyzeFens).size).toBe(plan.analyzeFens.length);
  });

  it('rejects a game with no recorded moves', () => {
    const parsed = gameFromPgn('[Event "?"]\n[Result "1-0"]\n\n1-0', {
      source: 'local',
      userColor: 'white',
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const result = planGameAnalysis(parsed.game);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no-moves');
    }
  });
});
