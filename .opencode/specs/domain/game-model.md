# Game Domain Model

A Game represents one imported chess game.

Required properties:

- id
- source
- externalId
- playedAt
- whitePlayer / blackPlayer (each a `Player` value object; the player's
  provider rating lives on `Player.rating`, superseding the earlier
  `whiteRating` / `blackRating` top-level fields)
- result
- PGN
- timeControl
- normalizedTimeControl
- user's color

Normalized time-control categories:

- bullet
- blitz
- rapid
- classical
- correspondence
- unknown

These are the canonical V1 categories. `timeControl` retains the original
source-provided string verbatim; `normalizedTimeControl` stores one of
the values above. The mapping is deterministic and versioned.

The exact time control is represented separately from its category: a
structured `TimeControl` value (base seconds, increment seconds,
days-per-turn, estimated length, display string) is parsed from the raw
string and persisted with the game (`specs/domain/time-control.md`). The
category is computed with one platform-agnostic rule so identical clocks
classify identically across platforms; the platform's own label is kept as
an optional hint. Consumers display `TimeControl.display` (house style
`M|I`, e.g. `5|5`, `10|0`) and never render raw seconds as minutes.

Game identity must be stable across repeated imports.
