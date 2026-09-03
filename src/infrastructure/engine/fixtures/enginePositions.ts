/**
 * Deterministic engine-verification positions (Feature 005, spec §16).
 *
 * These positions exercise unambiguous engine behaviour (mate, winning a
 * hanging piece, quiet/deep, en-passant and castling FEN coverage). They are
 * independent of imported user games and are never stored. Tests assert
 * engine *characteristics* (mate vs numeric evaluation, move sanity) rather
 * than exact numbers; the real-engine assertions live in the Playwright
 * suite.
 */

export interface EnginePositionFixture {
  readonly id: string;
  readonly label: string;
  readonly fen: string;
  /** Short user-facing description shown next to the fixture. */
  readonly exercises: string;
  /** What the engine should find here (characteristic, not an exact number). */
  readonly expectation: string;
  readonly expected: 'mate' | 'material' | 'quiet' | 'coverage';
}

export const ENGINE_POSITIONS: readonly EnginePositionFixture[] = [
  {
    id: 'engine-mate-in-1',
    label: 'Engine: back-rank mate in 1',
    fen: '6k1/5ppp/8/8/8/8/8/1R4K1 w - - 0 1',
    exercises: 'Mate-in-1 verification (Rb8#)',
    expectation: 'Stockfish reports a mate evaluation and a mating move.',
    expected: 'mate',
  },
  {
    id: 'engine-hanging-rook',
    label: 'Engine: win a hanging rook',
    fen: 'r3k3/5ppp/8/3Q4/8/8/5PPP/R5K1 w - - 0 1',
    exercises: 'Winning-material verification (Qxa8)',
    expectation: 'Stockfish evaluates a decisive material win for White.',
    expected: 'material',
  },
  {
    id: 'engine-quiet-start',
    label: 'Engine: quiet start position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    exercises: 'Quiet position needing deeper search',
    expectation: 'Stockfish returns a balanced numeric evaluation, no mate.',
    expected: 'quiet',
  },
  {
    id: 'engine-en-passant',
    label: 'Engine: en-passant capture available',
    fen: '4k3/8/8/3pPp2/8/8/8/4K3 w - f6 0 3',
    exercises: 'En-passant FEN coverage',
    expectation: 'Stockfish analyzes a position with a legal en-passant capture.',
    expected: 'coverage',
  },
  {
    id: 'engine-castling',
    label: 'Engine: castling rights position',
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    exercises: 'Castling-rights FEN coverage',
    expectation: 'Stockfish analyzes a position with full castling rights.',
    expected: 'coverage',
  },
] as const;

export type EnginePositionId = (typeof ENGINE_POSITIONS)[number]['id'];

export function findEnginePosition(id: EnginePositionId): EnginePositionFixture {
  const found = ENGINE_POSITIONS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown engine position: ${id}`);
  }
  return found;
}
