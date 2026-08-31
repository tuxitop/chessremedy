import { describe, expect, it } from 'vitest';
import {
  applyChessgroundMove,
  applySan,
  chessgroundDestsFromPosition,
  positionFromFen,
  positionToFen,
  startingPosition,
} from './chessopsAdapter';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('chessopsAdapter', () => {
  describe('FEN round-trip', () => {
    it('parses the standard starting FEN and re-emits it unchanged', () => {
      const pos = positionFromFen(STARTING_FEN);
      expect(positionToFen(pos)).toBe(STARTING_FEN);
    });

    it('round-trips the 8 playground single-FEN fixtures', () => {
      const fixtures = [
        STARTING_FEN,
        'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
        'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
        'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        '8/P7/8/8/8/8/8/4K2k w - - 0 1',
        '3k4/8/8/8/8/8/4Q3/4K3 w - - 0 1',
        'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      ];
      for (const fen of fixtures) {
        const pos = positionFromFen(fen);
        expect(positionToFen(pos)).toBe(fen);
      }
    });

    it('throws on an invalid FEN', () => {
      expect(() => positionFromFen('not a fen')).toThrow();
    });
  });

  describe('startingPosition', () => {
    it('returns a chessops Chess at the standard starting position', () => {
      const pos = startingPosition();
      expect(positionToFen(pos)).toBe(STARTING_FEN);
    });
  });

  describe('chessgroundDestsFromPosition', () => {
    it('returns legal destinations for the white e2 pawn at start', () => {
      const pos = startingPosition();
      const dests = chessgroundDestsFromPosition(pos);
      expect(dests.get('e2')).toEqual(['e3', 'e4']);
    });

    it('returns empty destinations for an empty endgame K+Q vs K', () => {
      const pos = positionFromFen('3k4/8/8/8/8/8/4Q3/4K3 w - - 0 1');
      const dests = chessgroundDestsFromPosition(pos);
      // White queen on e2 has multiple destinations
      expect(dests.get('e2')?.length).toBeGreaterThan(0);
    });
  });

  describe('applyChessgroundMove', () => {
    it('applies e2-e4 from the starting position and updates the FEN', () => {
      const pos = startingPosition();
      const next = applyChessgroundMove(pos, 'e2', 'e4');
      expect(next).not.toBeNull();
      expect(positionToFen(next!)).toBe(
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      );
    });

    it('returns null for an illegal move', () => {
      const pos = startingPosition();
      const result = applyChessgroundMove(pos, 'e2', 'e5');
      expect(result).toBeNull();
    });

    it('does not mutate the original position', () => {
      const pos = startingPosition();
      const fenBefore = positionToFen(pos);
      applyChessgroundMove(pos, 'e2', 'e4');
      expect(positionToFen(pos)).toBe(fenBefore);
    });
  });

  describe('applySan', () => {
    it('applies a SAN move and returns the next position', () => {
      const pos = startingPosition();
      const next = applySan(pos, 'e4');
      expect(next).not.toBeNull();
      expect(positionToFen(next!)).toBe(
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      );
    });

    it('returns null for an illegal SAN', () => {
      const pos = startingPosition();
      expect(applySan(pos, 'e5')).toBeNull();
      expect(applySan(pos, 'Nf6')).toBeNull();
    });
  });
});
