import { describe, expect, it } from 'vitest';
import { uciMoveArrow } from './boardShapes';

describe('uciMoveArrow', () => {
  it('builds a Chessground arrow shape from a plain UCI move', () => {
    expect(uciMoveArrow('e2e4', 'green')).toEqual({ orig: 'e2', dest: 'e4', brush: 'green' });
    expect(uciMoveArrow('h5f7', 'red')).toEqual({ orig: 'h5', dest: 'f7', brush: 'red' });
  });

  it('ignores the promotion role suffix (arrow uses only the from/to squares)', () => {
    expect(uciMoveArrow('e7e8q', 'green')).toEqual({ orig: 'e7', dest: 'e8', brush: 'green' });
  });

  it('returns null when the token does not carry two legal squares', () => {
    expect(uciMoveArrow('e2', 'red')).toBeNull();
    expect(uciMoveArrow('xyz9', 'red')).toBeNull();
    expect(uciMoveArrow('i1j2', 'red')).toBeNull();
    expect(uciMoveArrow('', 'red')).toBeNull();
  });

  it('keeps the requested brush colour on the shape', () => {
    expect(uciMoveArrow('d2d3', 'red')?.brush).toBe('red');
    expect(uciMoveArrow('d2d3', 'green')?.brush).toBe('green');
  });
});
