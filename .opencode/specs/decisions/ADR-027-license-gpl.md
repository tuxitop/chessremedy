# ADR-027: Project License — GPL-3.0-or-later

## Status

Accepted

## Decision

ChessRemedy is licensed under the **GNU General Public License version 3
or any later version** (GPL-3.0-or-later).

> Note: the original trigger for the relicense was adopting
> `@lichess-org/pgn-viewer` (ADR-029), which was later dropped
> (ADR-030). That trigger no longer applies, but the license decision
> stands on its own footing: Chessground and chessops are
> GPL-3.0-or-later, and the project retains a GPL-3.0-or-later posture
> per `AGENTS.md`. Reversing the license would require a new ADR.

## Reasons

- Chessground and chessops (both adopted via ADR-002/ADR-014 and
  ADR-028) are GPL-3.0-or-later; the project license is aligned with
  the dominant license of its chess stack.
- Originally the relicense was also forced by adopting
  `@lichess-org/pgn-viewer` (ADR-029); that dependency was later
  dropped (ADR-030) and no longer factors into the decision.

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

## Sources

- `AGENTS.md` (dependency policy)
- `ARCHITECTURE.md` §2 (technology block)
- ADR-002, ADR-014 (chessground adoption)
- ADR-028 (chessops)
- `history/ADR-029` (superseded pgn-viewer adoption)
