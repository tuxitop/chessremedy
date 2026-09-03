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
- puzzle first-try accuracy (per training set/cycle)
- puzzle solve rate
- cycle solving time (average/median per puzzle)
- hints and retries per cycle
- completion rate per cycle

Training metrics are defined in `specs/domain/tactical-training.md`
(cycle-level aggregates derived from puzzle attempts) and must not be
conflated with game-analysis metrics.

Aggregates must clearly indicate sample size.

## V1 sample-size rule

- Every aggregate displayed in the dashboard shows the underlying
  sample size as `n = X` adjacent to the value.
- The minimum sample size for any aggregate to be shown is **5**.
  Below this threshold the aggregate is hidden and replaced with an
  "insufficient data" placeholder.
- Mixed-platform or mixed-time-control views must be explicitly labeled
  as such and are never the default.

## Cycle-training comparisons

Cycle metrics are aggregates over the puzzles attempted in a cycle;
each value carries the number of puzzles it is based on. Cross-cycle
comparisons must use the same training set and the same metric
definition. A per-cycle accuracy based on fewer than 5 puzzles follows
the sample-size rule above, while a *series* of cycles may still be
shown when each cycle's own aggregate meets the rule. A change between
two cycles must never be labelled as proven improvement caused by the
training method (see `specs/domain/tactical-training.md`).
