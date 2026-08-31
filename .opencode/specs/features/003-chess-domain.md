# Feature 003 — Chess/Game Domain & Deterministic Fixtures

## Goal

Define the core domain models required by ChessRemedy and provide deterministic
fixtures that allow later features to be developed and tested without relying
on external services or user data.

This feature contains domain models, not UI-specific representations.

## Core concepts

The domain must define models for at least:

- Game
- Player
- Move
- Position
- TimeControl
- GameSource
- GameResult
- Analysis
- MoveAnalysis
- `MoveList` — the tree-structured PGN representation consumed by the
  move-list UI. Wraps chessops's `PgnNode` tree (see ADR-028) so the
  domain, the live analysis board, the move list, and the per-game
  review share a single position representation.

The model must preserve provider-specific identifiers and source information
without making the rest of the application dependent on Chess.com or Lichess
data formats.

## Game source

Initial supported sources:

- Chess.com
- Lichess
- Imported/local
- Fixture

The source model must be extensible for future providers.

## Time control

The application must preserve the original provider time-control information
and also provide a normalized time-control category.

The normalized categories must be defined consistently across all domain,
statistics and product specifications.

The design must allow statistics to be separated by time control.

A rapid game must never be silently aggregated with a blitz game in statistics
where time control is relevant.

## PGN

The domain must be able to represent imported chess games from valid PGN.

PGN parsing must use **chessops** (`chessops/pgn`) rather than a custom
parser. chessops exposes a true `PgnNode` tree with comments, variations,
and NAGs. The domain's `Game` model wraps a chessops `PgnNode` (or the
relevant sub-tree) directly so the move-list UI, the live analysis
board, and the per-game review surface share a single position
representation without any translation layer.

## Move representation

A move must preserve enough information to reconstruct:

- position before move
- move played
- position after move
- move number
- side to move
- SAN
- UCI where available

The model must support later engine analysis.

## Deterministic fixtures

Provide fixture data for development and automated tests.

Fixtures must include:

- several complete games
- games from Chess.com
- games from Lichess
- different time controls
- wins/losses/draws
- games containing obvious blunders
- games containing missed tactical opportunities
- games with no significant mistakes
- short games
- longer games
- opening/middlegame/endgame examples

Fixture games must be deterministic and must not be stored as user data.

## Fixture scenarios

Fixtures should also provide scenarios for:

- no games
- one game
- multiple games
- mixed platforms
- mixed time controls
- multiple games from different weeks

These fixtures will later be consumed by statistics and dashboard tests.

## Tests

Test:

- PGN parsing
- PGN parsing of nested variations (chessops `PgnNode` tree)
- comment / NAG round-trip
- game reconstruction
- move reconstruction
- time-control normalization
- source normalization
- FEN reconstruction
- fixture integrity

## Acceptance Criteria

All later application features can receive deterministic domain objects without
requiring external APIs, IndexedDB, Stockfish or real user data.
