# ADR-014: Chessground Version Pin

## Status

Accepted

## Decision

The chessboard implementation must use `@lichess-org/chessground`
at version 10.1.1 or any higher 10.x version. The installed version
must never be lower than 10.1.1 or outside the 10.x major range.

In `package.json`: `@lichess-org/chessground@^10.1.1`

## Reasons

- 10.1.1 is the baseline that includes all required features:
  arrows, highlights, touch support, responsive sizing, board
  themes, piece themes, animation, coordinates.
- Higher 10.x versions may contain bug fixes and performance
  improvements that benefit ChessRemedy.
- Major version changes (11.x) may introduce breaking API changes
  that require a new ADR before upgrading.

## Consequences

- The chessboard wrapper component isolates Chessground from the
  rest of the application. Application code interacts with the
  wrapper, not directly with Chessground.
- Replacing Chessground with another library (e.g., react-chessboard)
  requires a new ADR.
- This ADR supplements ADR-002 (Chessboard Library) by adding an
  explicit minimum version constraint. ADR-002 remains as the
  architectural decision to use Chessground; this ADR pins the
  version.

## Sources

- `AGENTS.md` section "Mandatory chessboard dependency"
- `ADR-002` (Chessboard Library)
- `specs/ARCHITECTURE.md` section 2
