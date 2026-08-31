# ADR-013: Time Control Categories

## Status

Accepted

## Decision

The canonical V1 normalized time-control categories are:

- bullet
- blitz
- rapid
- classical
- correspondence
- unknown

The original source time-control string is preserved verbatim in
`timeControl`. The normalized category is stored in
`normalizedTimeControl`.

## Reasons

- Chess.com and Lichess use different time-control strings.
  Normalization enables consistent statistics across platforms.
- Correspondence is retained because Lichess has correspondence
  games that would otherwise be miscategorized as classical.
- Unknown catches non-standard or future time-control values.
- Preserving the original string avoids data loss and enables
  debugging of normalization logic.

## Consequences

- The mapping from source string to normalized category is
  deterministic and versioned. When the mapping changes, a new
  version is recorded and existing records retain their original
  normalized value.
- Statistics must distinguish each of the six categories and must
  never silently combine different time controls.
- Mixed-platform or mixed-time-control views must be explicitly
  labeled and are never the default.
- Rating progress is separated by platform and time control.
- The minimum sample size for any displayed aggregate is 5.
  Below this threshold, an "insufficient data" placeholder is shown.

## Sources

- `specs/PRODUCT.md` section 6
- `specs/domain/game-model.md`
- `specs/domain/statistics.md`
