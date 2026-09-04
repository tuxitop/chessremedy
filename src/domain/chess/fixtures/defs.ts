/**
 * Deterministic fixture game definitions (Feature 003).
 *
 * Each fixture simulates a provider-style import (or a locally imported
 * game, or self-generated `fixture` content) so later features can be
 * developed without external APIs, IndexedDB, Stockfish or user data.
 *
 * Fixtures are never stored as user data. Provenance ("this came from the
 * fixtures module") is expressed by module location, while `Game.source`
 * carries the simulated platform/origin a later statistics feature groups
 * by (D5). Fixture ids for simulated Chess.com/Lichess games are therefore
 * indistinguishable from real imports at the data level — acceptable only
 * because fixtures are never persisted.
 */

import type { Color } from 'chessops/types';
import type { GameSource } from '../gameSource';

export const FIXTURE_TAGS = [
  'userBlunder',
  'opponentBlunder',
  'missedTactic',
  'clean',
  'short',
  'long',
  'opening',
  'middlegame',
  'endgame',
] as const;

export type FixtureTag = (typeof FIXTURE_TAGS)[number];

export interface GameFixtureDef {
  readonly id: string;
  readonly label: string;
  readonly source: GameSource;
  readonly externalId: string | null;
  readonly userColor: Color;
  readonly pgn: string;
  readonly tags: readonly FixtureTag[];
  readonly note?: string;
}

export const GAME_FIXTURE_DEFS: readonly GameFixtureDef[] = [
  {
    id: 'cc-bullet-blunder',
    label: 'Chess.com bullet: White walks into a fool\u2019s-mate-style loss',
    source: 'chesscom',
    externalId: '7123456701',
    userColor: 'white',
    tags: ['userBlunder', 'short'],
    note: 'ply 3 (2.g4??) allows Qh4#; user White loses.',
    pgn: `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.05.25"]
[White "chessremedy"]
[Black "bulletpete"]
[Result "0-1"]
[WhiteElo "1472"]
[BlackElo "1488"]
[TimeControl "60"]
[Termination "checkmate"]

1. f3 e5 2. g4?? Qh4# 0-1`,
  },
  {
    id: 'cc-blitz-clean',
    label: 'Chess.com blitz: Black buries White in the Blackburne Shilling mate',
    source: 'chesscom',
    externalId: '7123456702',
    userColor: 'black',
    tags: ['clean'],
    note: 'User Black wins by a mating attack without any gross errors of their own.',
    pgn: `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.05.28"]
[White "eagereddie"]
[Black "chessremedy"]
[Result "0-1"]
[WhiteElo "1510"]
[BlackElo "1535"]
[TimeControl "300+0"]
[Termination "checkmate"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`,
  },
  {
    id: 'cc-rapid-missed-tactic',
    label: 'Chess.com rapid: White misses a tactic but the game is agreed drawn',
    source: 'chesscom',
    externalId: '7123456703',
    userColor: 'white',
    tags: ['missedTactic', 'middlegame'],
    note: 'Intent: user White overlooked a winning tactical continuation yet the even game was agreed drawn.',
    pgn: `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.06.01"]
[White "chessremedy"]
[Black "rapidruth"]
[Result "1/2-1/2"]
[WhiteElo "1640"]
[BlackElo "1621"]
[TimeControl "600+5"]
[Termination "agreed"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O Nf6 6. d4 exd4 7. Nxd4 Bd7 8. Nc3 Be7 9. Re1 O-O 10. h3 Re8 11. Bf4 Bf5 12. Qd2 Qd6 13. Rad1 Rad8 1/2-1/2`,
  },
  {
    id: 'cc-classical-endgame',
    label: 'Chess.com classical: White punishes a queen blunder after a long build-up',
    source: 'chesscom',
    externalId: '7123456704',
    userColor: 'white',
    tags: ['long', 'opponentBlunder'],
    note: '12...Qa5?? drops the queen to 13.Nxa5; Black resigns. Long, classical-time game.',
    pgn: `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.06.05"]
[White "chessremedy"]
[Black "classyclark"]
[Result "1-0"]
[WhiteElo "1780"]
[BlackElo "1766"]
[TimeControl "1800"]
[Termination "resign"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. Nbd2 O-O 7. Bb3 h6 8. Nc4 a6 9. O-O Re8 10. h3 Ne7 11. Be3 c6 12. Qe2 Qa5?? 13. Nxa5 1-0`,
  },
  {
    id: 'li-bullet-missed-mate',
    label: 'Lichess bullet: White misses Qxf7# yet mates next move',
    source: 'lichess',
    externalId: 'bX7kQ2mZ',
    userColor: 'white',
    tags: ['missedTactic', 'short', 'opening'],
    note: 'ply 6 (4.d3) misses 4.Qxf7#; 4...Nd4 fails to defend and 5.Qxf7# lands.',
    pgn: `[Event "Rated Bullet game"]
[Site "https://lichess.org/bX7kQ2mZ"]
[Date "2026.06.08"]
[White "chessremedy"]
[Black "bulletbob"]
[Result "1-0"]
[UTCDate "2026.06.08"]
[UTCTime "10:12:33"]
[WhiteElo "1821"]
[BlackElo "1795"]
[TimeControl "60"]
[Termination "Normal"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nd4 5. Qxf7# 1-0`,
  },
  {
    id: 'li-blitz-blunder',
    label: 'Lichess blitz: Black hangs a rook to the Nxf7 fork',
    source: 'lichess',
    externalId: 'pL9dW3qA',
    userColor: 'black',
    tags: ['userBlunder', 'short'],
    note: 'ply 7 (4...h6??) allows 5.Nxf7 forking queen and rook; Black loses the rook and resigns.',
    pgn: `[Event "Rated Blitz game"]
[Site "https://lichess.org/pL9dW3qA"]
[Date "2026.06.11"]
[White "blitzbella"]
[Black "chessremedy"]
[Result "1-0"]
[UTCDate "2026.06.11"]
[UTCTime "20:04:12"]
[WhiteElo "1564"]
[BlackElo "1588"]
[TimeControl "300+2"]
[Termination "Normal"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 h6?? 5. Nxf7 Qe7 6. Nxh8 1-0`,
  },
  {
    id: 'li-rapid-clean',
    label: 'Lichess rapid: quiet Berlin-style draw',
    source: 'lichess',
    externalId: 'rT3nK8xC',
    userColor: 'black',
    tags: ['clean', 'middlegame'],
    note: 'User Black plays a solid, error-free game ending in an agreed draw.',
    pgn: `[Event "Rated Rapid game"]
[Site "https://lichess.org/rT3nK8xC"]
[Date "2026.06.15"]
[White "rapidron"]
[Black "chessremedy"]
[Result "1/2-1/2"]
[UTCDate "2026.06.15"]
[UTCTime "09:41:55"]
[WhiteElo "1720"]
[BlackElo "1705"]
[TimeControl "600+5"]
[Termination "Normal"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O Nxe4 5. d4 Nd6 6. Bxc6 dxc6 7. dxe5 Nf5 8. Qxd8+ Kxd8 9. Nc3 Ke8 10. Bf4 Be7 11. Rad1 h6 12. h3 Be6 13. Rfe1 Rd8 1/2-1/2`,
  },
  {
    id: 'li-classical-clean-win',
    label: 'Lichess classical: a clean attacking win crowned by Rd8#',
    source: 'lichess',
    externalId: 'wQ2mV7jH',
    userColor: 'white',
    tags: ['clean', 'long', 'middlegame'],
    note: 'User White converts a long attacking game (the Opera Game pattern) into mate.',
    pgn: `[Event "Rated Classical game"]
[Site "https://lichess.org/wQ2mV7jH"]
[Date "2026.06.19"]
[White "chessremedy"]
[Black "classyclaire"]
[Result "1-0"]
[UTCDate "2026.06.19"]
[UTCTime "15:22:48"]
[WhiteElo "1985"]
[BlackElo "1960"]
[TimeControl "1800"]
[Termination "Normal"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`,
  },
  {
    id: 'li-correspondence',
    label: 'Lichess correspondence: a long, quiet agreed draw',
    source: 'lichess',
    externalId: 'cZ9fP4sT',
    userColor: 'black',
    tags: ['long'],
    note: 'Correspondence time control exercised over a long, balanced game.',
    pgn: `[Event "Correspondence game"]
[Site "https://lichess.org/cZ9fP4sT"]
[Date "2026.06.22"]
[White "correspetr"]
[Black "chessremedy"]
[Result "1/2-1/2"]
[UTCDate "2026.06.22"]
[UTCTime "07:03:19"]
[WhiteElo "1950"]
[BlackElo "1930"]
[TimeControl "14 days per move"]
[Termination "Normal"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 12. Nbd2 Nc6 13. dxc5 dxc5 14. Nf1 h6 15. Ng3 Be6 16. Qe2 Rad8 1/2-1/2`,
  },
  {
    id: 'local-short-unknown-tc',
    label: 'Local import: quick loss with no time-control header',
    source: 'local',
    externalId: null,
    userColor: 'white',
    tags: ['userBlunder', 'short'],
    note: 'No TimeControl header present, so the normalized category is unknown.',
    pgn: `[Event "Casual game"]
[Site "Local"]
[Date "2026.05.26"]
[White "chessremedy"]
[Black "local-ned"]
[Result "0-1"]
[WhiteElo "1400"]
[BlackElo "1420"]
[Termination "checkmate"]

1. f4 e5 2. g4?? Qh4# 0-1`,
  },
  {
    id: 'local-fen-endgame',
    label: 'Local import: king-and-king FEN-start example ending in repetition',
    source: 'local',
    externalId: null,
    userColor: 'white',
    tags: ['endgame'],
    note: 'Exercises a [SetUp "1"] + [FEN "..."] start position; kings repeat and agree the draw.',
    pgn: `[Event "Position from analysis"]
[Site "Local"]
[Date "2026.06.03"]
[White "chessremedy"]
[Black "local-lena"]
[Result "1/2-1/2"]
[SetUp "1"]
[FEN "8/8/8/4k3/8/4K3/8/8 w - - 0 1"]
[TimeControl "900+10"]
[Termination "Normal"]

1. Kd3 Kd5 2. Ke3 Ke5 3. Kd3 Kd5 4. Ke3 Ke5 1/2-1/2`,
  },
  {
    id: 'local-missing-rating',
    label: 'Local import: a mate win with a missing White rating',
    source: 'local',
    externalId: null,
    userColor: 'white',
    tags: ['opponentBlunder', 'short'],
    note: 'WhiteElo is "?" so Player.rating is null; White wins by a Légal-style mate.',
    pgn: `[Event "Casual game"]
[Site "Local"]
[Date "2026.06.12"]
[White "chessremedy"]
[Black "local-omar"]
[Result "1-0"]
[WhiteElo "?"]
[BlackElo "1560"]
[TimeControl "300"]
[Termination "checkmate"]

1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1?? 6. Bxf7+ Ke7 7. Nd5# 1-0`,
  },
  {
    id: 'fx-sample-mate',
    label: 'Fixture-source sample: a short scholar\u2019s-mate win',
    source: 'fixture',
    externalId: null,
    userColor: 'white',
    tags: ['opponentBlunder', 'short', 'opening'],
    note: "Exercises the self-generated 'fixture' GameSource branch.",
    pgn: `[Event "Fixture sample"]
[Site "Fixture"]
[Date "2026.05.30"]
[White "chessremedy"]
[Black "sample-sam"]
[Result "1-0"]
[WhiteElo "1500"]
[BlackElo "1500"]
[TimeControl "1800"]
[Termination "checkmate"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# 1-0`,
  },
];
