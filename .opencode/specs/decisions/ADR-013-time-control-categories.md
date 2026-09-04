# ADR-013: Time-Control Model & Categories

## Status

Accepted (revised)

## Decision

The canonical V1 normalized time-control categories are:

- bullet
- blitz
- rapid
- classical
- correspondence
- unknown

The original source time-control string is preserved verbatim in
`timeControl`. The canonical category is stored in
`normalizedTimeControl`.

The exact time control (base seconds, increment seconds, days-per-turn,
estimated length) is represented as a structured value object and is
persisted on each game so every consumer (Game Library, Game Analysis,
statistics, charts, filters, reports) uses the same model instead of
re-deriving from the raw string.

The **canonical category is platform-agnostic**: it is a pure function of
the parsed clock using estimated length `base + 40 × increment` with the
Lichess-style boundaries (bullet ≤ 179 s, blitz 180–479 s, rapid
480–1499 s, classical ≥ 1500 s; no clock / daily ⇒ correspondence;
unparseable ⇒ unknown). A platform's own label (Lichess `speed`,
Chess.com `time_class`) is kept as an optional hint only and never
replaces the canonical category, because Chess.com and Lichess disagree on
several boundaries (e.g. `5+5` is Rapid on Lichess but Blitz on Chess.com;
Chess.com has no classical and calls `30+0` rapid).

The display house style is `M|I` (`5|5`, `10|0`, `3|2`) with fallbacks for
non-whole-minute bases and fractional increments. Raw seconds are never
shown as if they were minutes.

Full rules (parsing dialects, classification table, display formatter,
versioning) live in `specs/domain/time-control.md`; this ADR records the
decision and its consequences only.

## Reasons

- Chess.com and Lichess use different time-control strings and different
  category boundaries; one canonical rule makes statistics comparable
  across platforms while platform differences remain auditable.
- Correspondence is retained because Lichess has correspondence games
  that would otherwise be miscategorized as classical.
- Unknown catches non-standard or future time-control values.
- Preserving the original string avoids data loss and enables debugging
  of normalization logic.
- Storing a structured value removes repeated string parsing and lets
  statistics group by exact time control in addition to category.

## Consequences

- The mapping from source string to normalized category is deterministic
  and versioned. When the mapping changes, a new version is recorded and
  existing records retain their original normalized value (with an
  explicit, versioned re-normalization migration).
- Statistics must distinguish each of the six categories and must never
  silently combine different time controls.
- Mixed-platform or mixed-time-control views must be explicitly labeled
  and are never the default.
- Rating progress is separated by platform and time control.
- The minimum sample size for any displayed aggregate is 5. Below this
  threshold, an "insufficient data" placeholder is shown.
- The structured time control is persisted additively (schema v5); the
  existing `normalizedTimeControl` indexed column is retained.

## Sources

- `specs/domain/time-control.md` (canonical rules)
- `specs/PRODUCT.md` section 6
- `specs/domain/game-model.md`
- `specs/domain/statistics.md`
- Research: Lichess FAQ + scalachess `Speed.scala`/`Clock.scala`;
  Chess.com help center + PubAPI; chess.com & lichess PGN exports
