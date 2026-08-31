# Statistics

Statistics must preserve:

- platform
- time control
- date range

Primary analytical dimensions:

- Chess.com / Lichess
- bullet / blitz / rapid / classical / correspondence / unknown
- Opening / Middlegame / Endgame

Metrics may include:

- rating
- accuracy
- blunders per game
- mistakes per game
- inaccuracies per game
- missed tactics
- errors per 100 moves
- puzzle success
- training retention

Aggregates must clearly indicate sample size.

## V1 sample-size rule

- Every aggregate displayed in the dashboard shows the underlying
  sample size as `n = X` adjacent to the value.
- The minimum sample size for any aggregate to be shown is **5**.
  Below this threshold the aggregate is hidden and replaced with an
  "insufficient data" placeholder.
- Mixed-platform or mixed-time-control views must be explicitly labeled
  as such and are never the default.
