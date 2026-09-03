import { describe, expect, it } from 'vitest';
import { parsePositionFen } from '@/domain/chess';
import { isPromotionDestination } from './Chessboard';

function position(fen: string): ReturnType<typeof parsePositionFen> {
  return parsePositionFen(fen);
}

describe('isPromotionDestination', () => {
  it('is true for a white pawn reaching the eighth rank', () => {
    const parsed = position('4k3/4P3/8/8/8/8/8/4K3 w - - 0 1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(isPromotionDestination(parsed.position, 'e7', 'e8')).toBe(true);
    }
  });

  it('is true for a black pawn reaching the first rank', () => {
    const parsed = position('4k3/8/8/8/8/8/4p3/4K3 b - - 0 1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(isPromotionDestination(parsed.position, 'e2', 'e1')).toBe(true);
    }
  });

  it('is true for a pawn capturing onto the back rank', () => {
    const parsed = position('4k2r/4P3/8/8/8/8/8/4K3 w - - 0 1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(isPromotionDestination(parsed.position, 'e7', 'f8')).toBe(true);
    }
  });

  it('is false when a non-pawn moves to the back rank', () => {
    const parsed = position('3qk3/8/8/8/8/8/8/R3K3 w Q - 0 1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(isPromotionDestination(parsed.position, 'a1', 'a8')).toBe(false);
      expect(isPromotionDestination(parsed.position, 'e1', 'e8')).toBe(false);
    }
  });

  it('is false when a piece moves to a non-back rank', () => {
    const parsed = position('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(isPromotionDestination(parsed.position, 'e2', 'e4')).toBe(false);
    }
  });

  it('is false when the mover is not the side to move', () => {
    // White to move, but a black pawn sits on the seventh rank — only the
    // side to move can promote.
    const parsed = position('4k3/4p3/8/8/8/8/8/4K3 w - - 0 1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(isPromotionDestination(parsed.position, 'e7', 'e8')).toBe(false);
    }
  });
});
