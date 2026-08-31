# Game Domain Model

A Game represents one imported chess game.

Required properties:

- id
- source
- externalId
- playedAt
- whitePlayer
- blackPlayer
- whiteRating
- blackRating
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

Game identity must be stable across repeated imports.
