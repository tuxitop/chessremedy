# Feature 013 — Game Analysis History & Statistics

## Goal

Provide a domain-level statistics and history layer that calculates meaningful
training metrics from analyzed games and puzzle activity.

This feature is responsible for calculating and exposing statistics. It is
not responsible for rendering charts or dashboard UI.

All statistics must preserve relevant dimensions such as:

- time control
- platform
- game date
- game phase
- player side

Statistics must never combine incompatible time-control categories when doing
so would make the result misleading.

The implementation must be deterministic and independently testable using
fixture data. It must not require live Chess.com/Lichess access.

---

## Scope

This feature provides:

1. Analyzed-game history
2. Move-analysis aggregates
3. Mistake/blunder statistics
4. Missed-tactic statistics
5. Accuracy statistics
6. Game-phase statistics
7. Time-control statistics
8. Platform statistics
9. Rating/Elo history
10. Weekly trend data
11. Sample-size metadata
12. Statistics query/filtering

The dashboard will consume these results in Feature 014.

---

## Game Analysis History

The statistics layer must be able to query analyzed games by:

- date range
- platform
- time-control category
- player side
- result
- analyzed/unanalysed state where applicable

Each analyzed game must retain its source game and analysis metadata so that
statistics can be traced back to individual games.

Statistics must be derived from stored analysis rather than recalculated by
the dashboard.

---

## Time-Control Model

Time control is a mandatory dimension for statistics where appropriate.

The application must use the normalized time-control categories defined by
the domain specification.

At minimum, statistics must distinguish:

- Bullet
- Blitz
- Rapid
- Classical

Any additional categories such as Correspondence, Other or Unknown must follow
the canonical time-control model defined elsewhere and must not be silently
merged into one of the four categories above.

The original provider time-control value must remain available for inspection.

### Important rule

A rapid game and a blitz game must not be combined into a single trend when
the metric is affected by playing speed.

For example:

- blunders/game
- mistakes/game
- accuracy
- missed tactics/game

must support separate time-control views.

---

## Platform Model

Platform must remain a separate dimension.

At minimum:

- Chess.com
- Lichess
- Local/Imported where applicable

Rating/Elo history must be calculated separately for Chess.com and Lichess.

The system must never produce a single combined Elo trend from Chess.com and
Lichess ratings.

---

## Blunder and Mistake Statistics

For a selected set of games, provide:

- total blunders
- total mistakes
- average blunders per game
- average mistakes per game
- median blunders per game where useful
- percentage of games containing at least one blunder
- percentage of games containing at least one mistake

These metrics must be available by:

- week/time period
- time control
- platform where meaningful

The definition of blunder, mistake and other classifications comes from the
canonical move-classification domain specification and must not be duplicated
here.

---

## Missed Tactical Statistics

Provide:

- total missed tactical opportunities
- average missed tactics per game
- percentage of games containing a missed tactic

These must be filterable by:

- time control
- platform where meaningful
- game phase
- date/time period

---

## Accuracy Statistics

Accuracy must use the canonical accuracy methodology defined by the analysis
and classification specifications.

The statistics layer must not invent a second accuracy calculation.

For a group of games, the implementation must distinguish between:

- per-game accuracy
- aggregate accuracy

The aggregation method must be explicitly defined and tested.

Where averaging individual game accuracy would produce a misleading result,
the implementation must use the canonical aggregate method instead.

Accuracy trends must be separated by time control where applicable.

---

## Game Phase Statistics

Each analyzed move must belong to a canonical game phase:

- Opening
- Middlegame
- Endgame

The classification of game phase must come from the domain specification.

Statistics must provide, at minimum:

- number of mistakes by phase
- number of blunders by phase
- number of missed tactics by phase

Both absolute counts and normalized rates should be available where the sample
size makes the rate meaningful.

For example:

- blunders per 100 moves in opening
- blunders per 100 moves in middlegame
- blunders per 100 moves in endgame

The implementation must avoid presenting raw counts as directly comparable
when the number of moves/games in each phase differs substantially.

---

## Weekly Statistics

The statistics layer must support weekly aggregation.

For each week, the system should be able to provide:

- games played
- analyzed games
- average blunders/game
- average mistakes/game
- average missed tactics/game
- accuracy
- rating at the end of the period where available

Weekly statistics must be filterable by time control.

Example:

```text
Rapid
Week 1 → 2.4 blunders/game
Week 2 → 2.1
Week 3 → 1.8

Blitz
Week 1 → 3.7 blunders/game
Week 2 → 3.5
Week 3 → 3.4
```

These must remain separate series.

---

## Rating / Elo History

Rating history must be stored and queried separately for:

- Chess.com
- Lichess

The statistics layer must preserve the rating associated with the game where
available.

Rating trends must support:

- daily/chronological history
- weekly aggregation where appropriate
- selected date ranges
- platform filtering

The system must not calculate an artificial rating conversion between
Chess.com and Lichess.

Ratings from different platforms must not be averaged together.

Time control should also be available as a filtering dimension when the
provider supplies sufficient information to support it.

---

## Trend Data

The statistics service must return data suitable for visualization without
requiring the dashboard to perform statistical calculations.

For trend-based metrics, return:

- period start
- period end
- metric value
- sample size
- applicable platform
- applicable time control

Example conceptual result:

```text
{
  period: "2026-W34",
  metric: "blundersPerGame",
  value: 1.8,
  sampleSize: 14,
  timeControl: "rapid"
}
```

The exact implementation type is determined by the domain model.

---

## Sample Size

Every aggregate statistic must expose its sample size.

At minimum:

- number of games
- number of analyzed games where relevant
- number of moves where relevant

The UI must never imply that a statistic based on one or two games is equally
reliable as one based on dozens of games.

### Minimum sample rule

For V1:

- Aggregates may be calculated for any sample size.
- Sample size must always be returned.
- The presentation layer must be able to distinguish small samples.
- A trend should not be described as meaningful improvement solely because
  two consecutive periods differ.

The statistics layer must not invent statistical significance claims.

If a metric has no applicable observations, return an explicit empty/undefined
state rather than zero.

For example:

```text
No analyzed games
```

must not become:

```text
0 blunders/game
```

---

## Comparison and Improvement

The statistics layer may provide raw trend values and basic deltas such as:

- current period
- previous period
- absolute difference
- percentage difference where mathematically appropriate

It must not label a player as "improving" or "getting worse" based solely on
a simplistic change in one metric.

The dashboard may later interpret and present trends using these values.

Improvement comparisons must respect:

- same metric
- same time-control category
- same platform where relevant
- comparable date periods

For example, rapid blunders/game in Week 4 must not be compared with blitz
blunders/game in Week 3.

---

## Empty and Insufficient Data States

The statistics service must explicitly support:

- no games
- games but no analysis
- one analyzed game
- insufficient data for a comparison
- games from only one platform
- games from only one time control
- missing rating data
- missing time-control data

These states must be distinguishable from actual zero values.

---

## Performance

Statistics should be calculated from persisted analyzed data.

The dashboard must not require re-running Stockfish.

Repeated queries for the same dataset should avoid unnecessary full-game
reprocessing where practical.

The implementation may introduce cached/materialized statistics later if
performance requires it, but V1 must preserve a single authoritative source of
truth in the analyzed game data.

---

## Deterministic Fixtures

Provide statistics fixtures covering at least:

### Empty dataset

- zero games

### Small dataset

- one analyzed rapid game
- one platform
- known number of mistakes/blunders

### Mixed time controls

- rapid games
- blitz games
- bullet games

Verify that statistics never mix them when separated metrics are requested.

### Mixed platforms

- Chess.com games
- Lichess games

Verify that rating histories remain separate.

### Multiple weeks

Provide games across at least four weekly periods so trend calculations can
be tested.

### Game phases

Include analyzed games containing mistakes/blunders in:

- opening
- middlegame
- endgame

### Edge cases

Include:

- game with zero blunders
- game with multiple blunders
- game with no analyzed moves
- missing rating
- missing/unknown time control
- very small sample sizes

---

## Tests

Automated tests must verify:

### Aggregation

- total games
- total mistakes
- total blunders
- averages
- percentages
- sample sizes

### Time control

- rapid and blitz remain separate
- bullet and rapid remain separate
- unknown/other categories follow the canonical model

### Platform

- Chess.com and Lichess ratings remain separate

### Weekly trends

- games are assigned to the correct week
- weekly aggregates are deterministic
- empty weeks are represented correctly

### Game phases

- mistakes/blunders are correctly aggregated by phase
- normalized rates use the correct denominator

### Empty states

- no data is not represented as zero
- missing values remain distinguishable

### Comparisons

- deltas use comparable populations
- incompatible time controls are not compared

### Fixtures

All deterministic fixtures must produce deterministic statistics.

---

## Acceptance Criteria

1. The application can calculate statistics from analyzed fixture games
   without accessing Chess.com, Lichess or Stockfish.

2. Blunders, mistakes and missed tactics can be aggregated per game and per
   week.

3. Statistics can be separated by time-control category.

4. Chess.com and Lichess rating histories remain separate.

5. Game-phase statistics distinguish opening, middlegame and endgame.

6. Every aggregate exposes an appropriate sample size.

7. Empty data and zero-valued metrics are distinguishable.

8. The statistics service returns visualization-ready trend data.

9. The dashboard does not need to perform domain/statistical calculations.

10. All important aggregation behavior is covered by automated tests using
    deterministic fixtures.

11. The feature can be demonstrated locally with fixture data even when no
    real games have been imported.
