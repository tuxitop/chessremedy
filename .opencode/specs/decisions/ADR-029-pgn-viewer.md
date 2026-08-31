# ADR-029: PGN Move-List Renderer — @lichess-org/pgn-viewer

## Status

Accepted

## Decision

ChessRemedy uses **`@lichess-org/pgn-viewer@^2.6.4`** to render the PGN
move list (with variations, NAGs, comments, click-to-seek, keyboard
navigation, ARIA, mobile support, theming).

The library is wrapped by a thin React adapter
(`src/components/chessboard/PgnViewer.tsx`) that owns the host `<div>`
lifecycle and bridges ChessRemedy's React state into the viewer's
imperative API.

## Reasons

- **Feature-complete out of the box.** Variation tree, NAGs, per-move
  comments, click-to-seek, arrow keys / `f` to flip, ARIA roles,
  mobile/touch support, CSS-variable theming, Chessground integration.
- **License compatible.** GPL-3.0-or-later, matching ChessRemedy's
  project license (ADR-027).
- **Already requires chessops** (`chessops@^0.15.1`) — aligns with the
  chessops-first domain layer (ADR-028).
- **Uses chessground** (`@lichess-org/chessground@^10.1.1`) — the same
  board renderer ChessRemedy already mandates (ADR-002, ADR-014). No
  board-library conflict.

## Alternatives considered

- **In-house build on `@jackstenglein/chess` (MIT).** Same data model
  via chessops, but ~400–600 LoC of DOM + ARIA + keyboard code that
  would need continuous maintenance. Rejected: total cost of ownership
  is higher than adopting a battle-tested widget.
- **In-house build on `cm-pgn` (MIT).** Cleaner data shape, but
  community is smaller, no production track record with Chessground.
  Rejected for the same reason.
- **`react-pgn-viewer` (MIT).** Flat-list only — no variation tree,
  hard dependency on `react-chessboard` (conflicts with Chessground
  pin), 8 GitHub stars. Rejected.
- **`kokopu` + `kokopu-react` (LGPL).** Headless PGN + React viewer.
  LGPL-3.0-or-later is incompatible with MIT/derivative-work posture
  in ChessRemedy's prior license posture, and would also conflict
  with the new GPL-3.0-or-later posture only if ChessRemedy were
  relicensed to LGPL. Rejected.
- **Drop the move list entirely (use a flat list).** V1's Puzzle
  Training surface and the future Game Review surface both need a
  move-list view. Rejected as a feature cut.

## Consequences

- `package.json` adds `@lichess-org/pgn-viewer@^2.6.4`.
- The viewer's CSS variables must be exposed by `src/styles/tokens.css`
  so light/dark themes flow through.
- Bundle growth: `@lichess-org/pgn-viewer` + transitive `chessops`
  (already in bundle via ADR-028) + `snabbdom` ≈ 150–250 KB
  minified. The move-list bundle is lazy-loaded on pages that need it.
- All ChessRemedy chessboard surfaces (playground, live analysis
  board, game review, puzzle training) consume the same wrapper.
- The viewer is **imperative DOM + snabbdom**, not a React component.
  The wrapper bridges the imperative API to React state.

## Sources

- `specs/features/002-chessboard-chess-interaction.md` §"Chessboard
  capabilities"
- `specs/PRODUCT.md` §10 (Puzzle Training interface — `previous`,
  `next`, `start`, `end`)
- `ARCHITECTURE.md` §2 (technology block)
- `ADR-002`, `ADR-014` (chessground)
- `ADR-027` (project license)
- `ADR-028` (chessops)
