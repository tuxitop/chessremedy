# ADR-027: Project License — GPL-3.0-or-later

## Status

Accepted

## Decision

ChessRemedy is licensed under the **GNU General Public License version 3
or any later version** (GPL-3.0-or-later).

## Reasons

Adopting `@lichess-org/pgn-viewer@^2.6.4` (Feature 002) makes the SPA a
derivative work of that GPL-licensed library under copyleft terms. The
only legally clean path is to license the entire project under the
GPL-3.0-or-later.

Chessground and chessops (both already adopted via `@lichess-org/chessground`
and `@lichess-org/pgn-viewer`) are likewise GPL-3.0-or-later. The project
license is aligned with the dominant license of its chess stack.

## Consequences

- `package.json` sets `"license": "GPL-3.0-or-later"`.
- A `LICENSE` file at the repo root carries the full GPL-3.0-or-later
  text.
- `README.md` carries a `## License` section pointing at the file.
- The Dependency policy in `AGENTS.md` allows GPL-3.0-or-later
  dependencies (in addition to the previously-implicit MIT/BSD/Apache
  set). LGPL-3.0-or-later and AGPL-3.0-or-later remain forbidden.
- This decision is **irreversible** without a subsequent ADR and a
  community-style relicensing review.
- Chessops supersedes `chess.js` (ADR-028).
- The PGN move-list renderer is `@lichess-org/pgn-viewer`
  (ADR-029) — this is the decision that forced the relicense.

## Sources

- `AGENTS.md` (dependency policy)
- `ARCHITECTURE.md` §2 (technology block)
- ADR-002, ADR-014 (chessground adoption)
- ADR-028 (chessops)
- ADR-029 (pgn-viewer)
