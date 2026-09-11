# Statistics

Statistics must preserve:

- platform
- time control
- date range

Primary analytical dimensions:

- Lichess / Chess.com (canonical platform order; see `domain/game-library.md`)
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

**Missed-tactic exclusivity (ADR-023 amendment).** A ply whose analysis carries
a current-version verified missed tactic is not an `inaccuracy`, `mistake` or
`blunder`: the error counts (`blunders`/`mistakes`/`inaccuracies` and their
per-game rates/shares) and the per-phase `errorsPer100Moves` numerators exclude
it, and it is counted only in the missed-tactic metrics. Move-exposure
denominators (`userMoves`, per-phase `userMovesInPhase`/`detectedUserMovesInPhase`)
keep the ply. ADR-024 accuracy is **unchanged** and still includes the ply.
Before a current completed detection pass exists for an analysis, the raw
ADR-023 counts apply (the missed-tactic determination does not exist yet).

## V1 sample-size rule

- Every aggregate displayed in the dashboard shows the underlying
  sample size as `n = X` adjacent to the value.
- The minimum sample size for any aggregate to be shown is **5**.
  Below this threshold the aggregate is hidden and replaced with an
  "insufficient data" placeholder.
- Mixed-platform or mixed-time-control views must be explicitly labeled
  as such and are never the default.
- Aggregates never combine different time-control categories
  (`domain/time-control.md`); they may additionally group by the exact
  time control when useful, in which case the label shows the exact
  control (house style `M|I`). Categories are **platform-correct**
  (ADR-013): a `(platform, category)` partition uses that platform's own
  definition, so the same raw clock may appear in different categories on
  different platforms (e.g. `5|5` is Lichess `rapid`, Chess.com `blitz`).
  A source platform label (Lichess `speed`, Chess.com `time_class`) is
  never used in place of the canonical category in an aggregate.

## Cycle-training comparisons

Cycle metrics are aggregates over the puzzles attempted in a cycle;
each value carries the number of puzzles it is based on. Cross-cycle
comparisons must use the same training set and the same metric
definition. A per-cycle accuracy based on fewer than 5 puzzles follows
the sample-size rule above, while a *series* of cycles may still be
shown when each cycle's own aggregate meets the rule. A change between
two cycles must never be labelled as proven improvement caused by the
training method (see `specs/domain/tactical-training.md`).
