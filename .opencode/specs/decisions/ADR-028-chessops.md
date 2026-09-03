# ADR-028: Chess State Management — chessops

## Status

Accepted

## Supersedes

ADR-003 (chess.js for chess rules and legal move/state management).

## Decision

ChessRemedy V1 uses **`chessops@^0.15.1`** for chess rules, position
representation, FEN handling, move validation, SAN/UCI parsing, and PGN
parsing (including variations, NAGs, and comments).

chessops is the same library that powers Lichess's own analysis and study
UI.

> Note: an earlier reason — "chessops is already a transitive
> dependency of `@lichess-org/pgn-viewer`, so adopting it is free" — no
> longer applies because pgn-viewer was dropped (ADR-030). chessops is
> now a direct dependency, adopted on its own merits below.

## Reasons

- **Full PGN tree support.** chess.js v1.x has no native variation
  (RAV) parsing and no NAGs API. chessops's `chessops/pgn` exposes a
  true `PgnNode` tree with comments, variations, and NAGs — exactly
  what the move list and the live analysis board require.
- **License alignment.** chessops is GPL-3.0-or-later; ChessRemedy
  adopts the same license (ADR-027).
- **Immutable API.** chessops returns new positions on every move, which
  pairs naturally with React's reducer patterns and time-travel
  debugging. chess.js is mutating, which forces adapter wrappers in
  React contexts.
- **Chessground integration.** `chessops/compat.chessgroundDests` is
  the documented path to drive Chessground's `movable.dests` from a
  chessops position.
- **Lichess provenance.** chessops powers Lichess analysis/study; the
  chess-domain plan (Feature 003) and move list (ADR-030) build on it.

## Consequences

- `chess.js` is **not** added to `package.json`. ADR-003 is superseded.
- ChessRemedy domain models (`Game`, `Move`, `Position`, etc., defined
  by Feature 003) are chessops-flavored and re-export chessops's
  `PgnNode` tree.
- The chessground wrapper (Feature 002) uses
  `chessops/compat.chessgroundDests(position)` to translate legal-move
  maps. The translation is a single helper in
  `src/components/chessboard/chessopsAdapter.ts`.
- The move list is a custom React component over `chessops/pgn`
  (ADR-030); chessops is the move-list data source.
- Future contributor who tries to add `chess.js` back is blocked by a
  CI guard (and by this ADR + the Superseded marker on ADR-003).

## Sources

- `AGENTS.md` "Architecture principles"
- `ARCHITECTURE.md` §2 (technology block)
- `ADR-027` (project license)
- `ADR-030` (drop pgn-viewer; chessops becomes a direct dependency)
- `history/ADR-029` (superseded pgn-viewer adoption)
- `specs/research/testing-stack.md` (general dependency policy context)
