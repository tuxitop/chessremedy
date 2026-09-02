/**
 * Deterministic playground fixtures for Feature 002.
 *
 * Each entry is either:
 *  - a single FEN (the board lands on that position, no history), or
 *  - a PGN string (the board lands on the end of the PGN's mainline and
 *    the move list shows the full sequence). A PGN may carry its own
 *    `[SetUp "1"]` + `[FEN "..."]` headers, which define its start
 *    position (see fixture `white-to-move-and-lose`).
 *
 * Every PGN is validated (replayed legally from its start position) by
 * `positionTree.buildTreeFromPgn`; an inconsistent PGN surfaces an error
 * to the caller instead of being silently "fixed". Fixtures never touch
 * IndexedDB.
 */

export interface FenFixture {
  readonly id: string;
  readonly kind: 'fen';
  readonly label: string;
  readonly fen: string;
  readonly exercises: string;
}

export interface PgnFixture {
  readonly id: string;
  readonly kind: 'pgn';
  readonly label: string;
  readonly pgn: string;
  readonly exercises: string;
}

export type PlaygroundFixture = FenFixture | PgnFixture;

export const PLAYGROUND_FIXTURES: readonly PlaygroundFixture[] = [
  {
    id: 'starting',
    kind: 'fen',
    label: 'Starting position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    exercises: 'Piece rendering, legal-move dests',
  },
  {
    id: 'scholars-mate-position',
    kind: 'fen',
    label: "Scholar's Mate position",
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    exercises: 'Tactical move execution',
  },
  {
    id: 'foolsmate',
    kind: 'fen',
    label: 'Fool\u2019s Mate (white to move)',
    fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    exercises: 'Check highlighting, forced moves',
  },
  {
    id: 'capture',
    kind: 'fen',
    label: 'Capture',
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    exercises: 'Capture interaction, piece removal',
  },
  {
    id: 'annotation-demo',
    kind: 'pgn',
    label: 'Comment arrows & highlights (annotation demo)',
    pgn: '1. e4 {[%cal Ge2e4,Rd7d5] [%csl Gd4,Re5]} e5 2. Nf3',
    exercises: 'Comment-driven arrows (%cal) and square highlights (%csl)',
  },
  {
    id: 'promotion',
    kind: 'fen',
    label: 'Promotion',
    fen: '8/P7/8/8/8/8/8/4K2k w - - 0 1',
    exercises: 'Pawn promotion dialog',
  },
  {
    id: 'endgame-kq',
    kind: 'fen',
    label: 'Endgame (K+Q vs K)',
    fen: '3k4/8/8/8/8/8/4Q3/4K3 w - - 0 1',
    exercises: 'Simplified endgame, few legal moves',
  },
  {
    id: 'non-standard-fen',
    kind: 'fen',
    label: 'Non-standard FEN (castling rights)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    exercises: 'Tricky castling rights, complex legal moves',
  },
  {
    id: 'italian-black-to-move',
    kind: 'pgn',
    label: 'Italian Game \u2014 Black to play',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4',
    exercises: 'Black-to-move landing, orientation auto-flip',
  },
  {
    id: 'scholars-mate-game',
    kind: 'pgn',
    label: "Scholar's Mate game",
    pgn: '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#',
    exercises: 'Move list, end-of-game, navigation',
  },
  {
    id: 'variation-tree',
    kind: 'pgn',
    label: 'Variation tree (Italian, white plays Bb5 vs Bc4)',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4) a6 4. Ba4',
    exercises: 'Variation rendering, click-to-seek into variation',
  },
  {
    id: 'pin-tactic',
    kind: 'pgn',
    label: 'Fried Liver / Lolli sacrifice',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7! Kxf7 7. Qf3+',
    exercises: 'Sacrifice, NAG `!` rendering',
  },
  {
    id: 'white-to-move-and-lose',
    kind: 'pgn',
    label: 'White to move and lose',
    pgn: '[Event "White to move and lose"]\n[SetUp "1"]\n[FEN "8/8/8/8/8/1k6/3q4/QK6 w - - 0 1"]\n\n1. Qa4+ Kxa4 2. Ka1 Ka3 3. Kb1 Qb2# 0-1',
    exercises: 'Checkmate badge, result line, header-carrying PGN',
  },
  {
    id: 'nag-inline',
    kind: 'pgn',
    label: 'NAG annotations (inline glyphs)',
    pgn: '1. e4! e5 2. Nf3!! Nc6? 3. Bb5?! a6!? 4. Ba4 Nf6??',
    exercises: 'Inline NAG glyphs and move coloring',
  },
  {
    id: 'nag-numeric',
    kind: 'pgn',
    label: 'NAG annotations (numeric $N)',
    pgn: '1. e4 $1 e5 $2 2. Nf3 $3 Nc6 $4 3. Bb5 $5 a6 $6',
    exercises: 'Numeric NAG glyphs and move coloring',
  },
  {
    id: 'comments',
    kind: 'pgn',
    label: 'Comments',
    pgn: "1. e4 {The King's Pawn opening} e5 {A solid response} 2. Nf3 {Developing the knight toward the center} Nc6",
    exercises: 'Readable PGN comments in the move list',
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
  return fixture.kind === 'pgn';
}
