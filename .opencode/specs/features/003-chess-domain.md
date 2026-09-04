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

The application must preserve the original provider time-control
information, represent the exact time control (base, increment,
days-per-turn) separately from its normalized category, and persist both
with the game.

The normalized categories must be defined consistently across all domain,
statistics and product specifications (see `domain/time-control.md` and
ADR-013). The canonical category is platform-agnostic; provider-specific
labels are optional hints only.

The design must allow statistics to be separated by time control.

A rapid game must never be silently aggregated with a blitz game in statistics
where time control is relevant.

Time controls are displayed in `M|I` house style (`5|5`, `10|0`, `3|2`);
raw seconds are never shown as if they were minutes.

## PGN clocks

`[%clk …]` clock annotations in PGN comments must be parsed as structured
per-move clock data (the mover's remaining time after the move,
`domain/clock.md`) and never displayed as ordinary comments. When absent,
clock data is omitted.

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
- each time-control dialect (Lichess `300+5`, Chess.com `600`, chess.com
  fractional `10+0.1`, chess.com daily `1/259200`, Lichess correspondence
  `"14 days per move"`, `-`/unknown)
- at least one game whose PGN carries `[%clk …]` clock annotations and one
  without

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
- time-control parse/classify/format across dialects (incl. boundary and
  display cases)
- PGN clock (`%clk`) parsing, association with the correct move, missing
  and malformed annotations
- source normalization
- FEN reconstruction
- fixture integrity

## Acceptance Criteria

All later application features can receive deterministic domain objects without
requiring external APIs, IndexedDB, Stockfish or real user data.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md`; `decisions/ADR-028`,
  `decisions/ADR-013`, `decisions/ADR-001`; `history/ADR-003`
  (history only)
- Domain: `domain/game-model.md`
- Research: `research/testing-stack.md`, optional
  `research/game-import.md` (provider header shapes)

Feature dependencies: Features 001, 002 (none hard).
