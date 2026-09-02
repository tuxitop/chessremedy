# ADR-030: Drop @lichess-org/pgn-viewer

## Status

Accepted

## Supersedes

ADR-029 (PgnViewer was the rationale for ADR-029).

## Decision

ChessRemedy no longer uses `@lichess-org/pgn-viewer`. The PGN move list is
rendered by a custom React-only `MoveList` component built on top of
`chessops/pgn` (see ADR-028).

## Reasons

- The Lichess viewer renders its DOM with `snabbdom`, which conflicts with
  React 19's reconciler when both libraries try to manage the same DOM
  root. The symptom was a half-rendered playground ("small navigation
  bar", missing move list, "board theme gets messy", "page gets broken
  until refresh") whenever a PGN fixture was selected.
- A custom `MoveList` gives us full ownership of styling (we want a
  Lichess-like look per the user's UX feedback), accessibility (ARIA
  roles, keyboard nav), and the behaviour contract (click-to-seek,
  NAG glyphs, variation indentation, comment rendering).
- The required data is already in scope: `chessops/pgn` parses full PGN
  trees (variations, NAGs, comments) and exposes the same model that
  the Lichess viewer used internally.

## Consequences

- `@lichess-org/pgn-viewer` is removed from `package.json` runtime
  dependencies.
- `src/components/chessboard/PgnViewer.tsx` and `PgnViewer.module.css`
  are deleted.
- `public/vendor/pgn-viewer/` and `scripts/copy-vendor-assets.mjs`
  are deleted. The `postinstall` script entry in `package.json` is
  removed.
- The Move list bundle is now pure React — no snabbdom dependency,
  no DOM conflict, no virtual-DOM implementation competing with
  React.
- License posture (ADR-027, GPL-3.0-or-later) is unchanged. The
  relicense rationale referenced pgn-viewer; that rationale no
  longer applies, but per ADR-027's "irreversible without a
  subsequent ADR" clause the license stays GPL unless a future ADR
  explicitly reverses it.

## Sources

- `specs/features/002-chessboard-chess-interaction.md` §"Chessboard
  capabilities"
- `chessops/pgn` API (`parsePgn`, `PgnNode`)
- ADR-027 (project license)
- ADR-028 (chessops adoption)
- ADR-029 (pgn-viewer — superseded)