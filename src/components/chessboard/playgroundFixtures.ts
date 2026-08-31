/**
 * Deterministic playground fixtures for Feature 002.
 *
 * Each entry is either a single FEN (single-position fixture) or a PGN
 * string with an initial FEN (sequence fixture). The playground owns
 * the fixture data and never inserts it into IndexedDB.
 */

export interface SingleFenFixture {
  readonly id: string;
  readonly label: string;
  readonly fen: string;
  /** Whether the user can play moves interactively. */
  readonly interactive: boolean;
  readonly exercises: string;
}

export interface PgnFixture {
  readonly id: string;
  readonly label: string;
  readonly fen: string;
  readonly pgn: string;
  readonly interactive: boolean;
  readonly exercises: string;
}

export type PlaygroundFixture = SingleFenFixture | PgnFixture;

export const PLAYGROUND_FIXTURES: readonly PlaygroundFixture[] = [
  {
    id: 'starting',
    label: 'Starting position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    interactive: true,
    exercises: 'Piece rendering, legal move dests',
  },
  {
    id: 'scholars-mate',
    label: "Scholar's Mate position",
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    interactive: true,
    exercises: 'Tactical move execution, position updates',
  },
  {
    id: 'check',
    label: 'Check (Fool\u2019s Mate)',
    fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    interactive: true,
    exercises: 'Check highlighting, forced moves',
  },
  {
    id: 'capture',
    label: 'Capture',
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    interactive: true,
    exercises: 'Capture interaction, piece removal',
  },
  {
    id: 'arrows-highlights',
    label: 'Arrows + highlights',
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    interactive: true,
    exercises: 'Arrow rendering, square highlighting',
  },
  {
    id: 'promotion',
    label: 'Promotion',
    fen: '8/P7/8/8/8/8/8/4K2k w - - 0 1',
    interactive: true,
    exercises: 'Pawn promotion interaction',
  },
  {
    id: 'endgame',
    label: 'Endgame (K+Q vs K)',
    fen: '3k4/8/8/8/8/8/4Q3/4K3 w - - 0 1',
    interactive: true,
    exercises: 'Simplified endgame, few legal moves',
  },
  {
    id: 'non-standard-fen',
    label: 'Non-standard FEN',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    interactive: true,
    exercises: 'Tricky castling rights, complex legal moves',
  },
  {
    id: 'scholars-mate-game',
    label: "Scholar's Mate game",
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#',
    interactive: true,
    exercises: 'Move list, end-of-game, navigation',
  },
  {
    id: 'variation-tree',
    label: 'Variation tree',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4',
    interactive: true,
    exercises: 'Variation tree rendering, Alt+\u2192 switching',
  },
] as const;

export type PlaygroundFixtureId = (typeof PLAYGROUND_FIXTURES)[number]['id'];

export function findFixture(id: PlaygroundFixtureId): PlaygroundFixture {
  const found = PLAYGROUND_FIXTURES.find((f) => f.id === id);
  if (!found) {
    throw new Error(`Unknown playground fixture: ${id}`);
  }
  return found;
}

export function isPgnFixture(fixture: PlaygroundFixture): fixture is PgnFixture {
  return 'pgn' in fixture;
}
