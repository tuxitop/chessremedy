import { describe, expect, it } from 'vitest';
import { gameFromPgn } from '@/domain/chess/parseGame';
import { gameEndOf, terminationLabel } from '@/domain/chess/gameEnd';

function endOf(pgn: string): ReturnType<typeof gameEndOf> {
  const parsed = gameFromPgn(pgn, { source: 'local', userColor: 'white' });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return gameEndOf(parsed.game.moves, parsed.game.result);
}

const HEADER = (result: string): string =>
  `[White "a"]\n[Black "b"]\n[Result "${result}"]\n[TimeControl "600"]\n\n`;

describe('gameEndOf', () => {
  it('detects checkmate and the move count', () => {
    const end = endOf(`${HEADER('0-1')}1. f3 e5 2. g4 Qh4# 0-1`);
    expect(end.termination).toBe('checkmate');
    expect(end.moveCount).toBe(2);
    expect(terminationLabel(end.termination)).toBe('Checkmate');
  });

  it('leaves flag/resignation decisive endings unknown', () => {
    const end = endOf(`${HEADER('1-0')}1. e4 e5 2. Nf3 1-0`);
    expect(end.termination).toBeNull();
    expect(end.moveCount).toBe(2);
  });

  it('treats an agreed draw as a draw', () => {
    const end = endOf(`${HEADER('1/2-1/2')}1. e4 e5 1/2-1/2`);
    expect(end.termination).toBe('agreement');
    expect(end.moveCount).toBe(1);
  });
});
