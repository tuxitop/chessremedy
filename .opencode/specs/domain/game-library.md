# Game Library Domain Model

Owns the canonical, domain-side model for the Game Library page
(Feature 007 milestone 2). Pure and framework-agnostic: no React, no
Dexie, no network. Consumers: Feature 007 UI; later Feature 008 (bulk
analysis entry and analysis status), 010 (missed-tactic counts and the
analysis-result filters registered in `features/010-tactical-detection.md`),
011 (puzzles-from-game), 014 (statistics/history aggregation), 016
(deletion tombstones).

Platform presentation order is canonical across the product:
**Lichess, Chess.com**. Wherever a platform enumeration is rendered or
documented it is shown in that order (source keys `lichess`,
`chesscom`).

## 1. Canonical filter/search state

One serializable type drives the page:

```ts
type GameLibraryFilters = {
  search: string;                 // trimmed, collapsed whitespace
  timeFrame:
    | 'all' | 'today' | 'last7d' | 'last30d' | 'last3m'
    | 'last6m' | 'lastYear'
    | { kind: 'custom'; from: string /* yyyy-mm-dd */; to: string }
  timeControl: 'all' | TimeControlCategory; // ADR-013 set
  side: 'all' | Color;             // userColor (White | Black)
  platform: 'all' | 'lichess' | 'chesscom'; // GameSource subset
  // Analysis-result dimensions (registered by the Feature-010 milestone,
  // features/010-tactical-detection.md "Game Library Integration").
  analysis: 'all' | 'analyzed' | 'notAnalyzed';
  hasBlunders: 'all' | 'yes' | 'no';
  hasMissedTactics: 'all' | 'yes' | 'no';
};
```

Defaults: `all` everywhere, empty search. Single select per dimension in
V1; the model is not coupled to the control type (multi-select can be
added without redesign). Reuse `GameSource`, `TimeControlCategory`
(ADR-013), and `Color` from the existing domain — never duplicate them.
The analysis-result dimensions follow the same canonical rules as the
metadata dimensions: default `all`, AND with every other filter and
search, URL-encoded state, and selection cleared whenever filters or
search change.

## 2. Filter semantics

- Time control, side, and platform are equality filters over stored
  normalized fields: `normalizedTimeControl`, `userColor`, `source`.
  The UI never parses time-control strings; rows display the formatted
  exact control (`TimeControl.display`, house style `M|I` per
  `domain/time-control.md`) separately from the category.
- Time control includes every ADR-013 category (bullet, blitz, rapid,
  classical, correspondence, unknown) plus All; `unknown`/correspondence
  are kept distinct and never merged.
- Multiple dimensions combine with AND.

### Analysis-result dimensions

The `analysis`, `hasBlunders` and `hasMissedTactics` dimensions are
single-select filters over analysis-derived facts (default `all`). Their
full user-facing and layout behaviour is defined by the Feature-010
milestone (`features/010-tactical-detection.md`, "Game Library
Integration"); the canonical semantics are:

- **`analysis`** — `analyzed` matches a game whose latest analysis
  status is `completed` or `outdated` (a completed run exists per the
  Feature-008 status derivation over persisted analysis jobs);
  `notAnalyzed` matches every other status (`unanalyzed`, `queued`,
  `inProgress`, `cancelled`, `failed`). Evaluated from persisted
  analysis-job state, never from transient UI state.
- **`hasBlunders`** — evaluated on the user side of the game's latest
  completed analysis: `yes` = at least one user move classified
  `blunder`; `no` = a completed analysis exists and zero user blunders.
  Games without a completed analysis match neither `yes` nor `no`.
- **`hasMissedTactics`** — `yes` = the latest completed analysis's
  detection pass completed and at least one user move carries
  `missedTactic: true`; `no` = the detection pass completed and zero.
  Games without a completed analysis, or whose detection pass has not
  completed, match neither outcome: **absent is not zero** (the
  missed-tactic count has no value until detection ran).

`yes`/`no` outcomes are evaluated against the game-scoped **per-analysis
summary** described in §7 — never by scanning `MoveAnalysis` rows. A
filter change must push down into the Library query (ARCHITECTURE.md §7
data flow) so results stay practical from a few to thousands of games.

## 3. Date filtering (time zone and boundaries)

`playedAt` is stored as an ISO-8601 UTC instant. Date filtering is
applied in the **user's local time zone**:

- `from` (custom or preset start): inclusive from `00:00:00.000` local.
- `to` (custom): inclusive through the end of that local day.
- Presets are resolved backwards from a caller-supplied `now` in whole
  **calendar days**: Last N days = from local midnight (N−1) days before
  today's local date through `now`. Last 3m/6m/lastYear step back whole
  calendar months/years from today's local date (clamped), from local
  midnight of that start day through `now`.
- Custom day boundaries convert local calendar dates to UTC instants
  through the host time zone; all comparisons then use the UTC instant
  of `playedAt`.
- Validation: valid `yyyy-mm-dd` calendar dates; `from ≤ to`.
- Tests: run under a pinned `TZ` and with explicit-offset cases; pure
  resolution functions take `now`.

Inclusive boundaries are: start-of-day inclusive for `from`, end-of-day
inclusive for `to`.

## 4. Search

Matches **any** field (OR across fields), case-insensitive, after trim +
whitespace collapsing:

- White player name,
- Black player name,
- external game id.

Empty/whitespace search is a no-op. Search ANDs with all other filters.
Opening/ECO search is deferred (no stored opening data).

## 5. Sorting

Default: newest first by `playedAt` (null last). V1 exposes only this
order. The model keeps a comparator registry keyed by sort key
(`date`, and future `rating`, `opponent`, `result`, `timeControl`) so
keys can be added without redesign.

## 6. Selection

`Selection = Set<GameId>`, independent of rendered DOM rows. Operations:

- toggle(id);
- selectAll(ids) — ids of the **current filtered result set**;
- clear();
- isSelected(id); count.

Rules: selection is **cleared** when filters or search change, when a
filtered result set is replaced, or after deletion. Deletion never
operates on hidden games because selection always reflects the current
result set at the time of the action.

## 7. Row view and extensibility (future features)

Rows are rendered from an extensible read model:

```ts
type LibraryGameView = GameSummary & {
  insights: Partial<{
    accuracy: number;                 // user per-game accuracy, latest completed analysis (ADR-024)
    analysisStatus:
      | 'unanalyzed'|'queued'|'inProgress'|'completed'|'cancelled'|'failed'
      | 'outdated';                   // Feature 008 (persisted jobs + version)
    classificationCounts: {           // user-side counts, latest completed analysis
      best: number;                   //   canonical Feature-009 per-game summary
      good: number;                   //   (one ADR-023 classification per persisted move)
      inaccuracy: number;
      mistake: number;
      blunder: number;
    };
    detectionState:                  // Feature-010 pass state of the latest completed analysis
      | 'absent'                     //   never scanned (older run / not yet scheduled)
      | 'queued' | 'inProgress'      //   scheduled; running only if the service says so
      | 'completed' | 'failed';      //   completed ⇒ missedTactics is a real number
    missedTactics: number;            // user-side, only when a detection pass completed (010)
    puzzleCount: number;              // 011
    masteredPuzzleCount: number;      // 012/013/014
  }>;
};
```

Insights are **read-only consumers** of values computed by Features
008–014; the Library never calculates them and renders only present
values. The per-game accuracy, classification counts and missed-tactic
count shown in a row's insights strip are produced by the
analysis/detection pipeline and persisted as a game-scoped
**per-analysis summary** (keyed by game + analysis identity) when an
analysis run completes and, for missed tactics, when the Feature-010
detection pass completes. The values are canonical Feature-009 domain
functions over the latest completed analysis's persisted `MoveAnalysis`
(accuracy per ADR-024; classification counts per
`domain/classification.md`), plus the Feature-010 `missedTactic`
annotations — never a second computation on the page. See
`features/010-tactical-detection.md`, "Game Library Integration".

Strip semantics:

- The strip renders only when the game has a completed analysis run
  (status `completed` or `outdated`). Unanalyzed, queued, in-progress,
  cancelled and failed games show no strip — absent data is never
  rendered as zeros.
- All values derive from the **latest completed analysis** (the run the
  Feature-008 status derivation treats as completed); an `outdated` run
  still renders, flagged outdated, until opt-in re-analysis replaces it;
  a queued/in-progress re-analysis hides the strip until the new run
  completes.
- Values are user-side only (`Game.userColor`); opponent counts remain
  Game Review context.
- **Absent vs zero for missed tactics**: `missedTactics` is present only
  when the detection pass has completed for the latest completed
  analysis. Not-yet-detected is absent (the strip omits the item or
  shows an em-dash, and no `hasMissedTactics` outcome matches); a
  completed pass that found nothing is the value `0`. Detection results
  are scoped to the analysis identity, so re-analysis starts absent again
  until its new pass completes.
- **Detection state is surfaced, never silent**: a completed run whose
  pass has not finished shows one of the Feature-010 state items instead
  of a missing/zero missed-tactic value — `queued`/`inProgress` render
  "scanning…" only while the analysis service reports the game as
  actively detecting (in-memory session registry); otherwise such a
  summary is an interrupted pass ("Tactics scan interrupted"), `failed`
  is a failed attempt and `absent` is "Tactics not scanned". The Library
  refreshes the strip while a scan is live and stops as soon as nothing
  is running, so an interrupted pass never keeps polling.

Row actions are registered by capability:

```ts
type GameActionCapability =
  | 'liveAnalysis'|'review'|'puzzles'|'analyze'|'delete';
```

Feature 008 registers `analyze`/`review` (and re-analysis as an action on
an analyzed row) and supplies analysis status incl. an `outdated` state
(an older analysis exists but a newer engine/version supersedes it).
Actions are surfaced through selection/contextual toolbars and per-row
menus so they are discoverable without scrolling; bulk **Analyze** no
longer requires the bottom of a long page. Future features register their
row action (live analysis with the game, puzzles from this game) without
changing the Library layout.

## 8. Deletion & data ownership

Ownership rule (mirrors `ARCHITECTURE.md` §7):

```
Game
 ├── Analysis          (per game, deleted with the game)
 ├── Puzzle Candidate  (deleted with the game)
 └── Puzzle(s)         (deleted with the game)
       └── Puzzle attempts / set membership  (removed/invalidated)
```

- Deleting a game deletes its game-scoped derived rows (analyses,
  puzzle candidates, puzzles) and transitively puzzle attempts and
  training-set memberships once those exist.
- The **engine analysis cache (ADR-018) is retained**: it is keyed by
  FEN, positions are shared across games, and entries are a performance
  cache, not game-scoped state.
- V1 deletes only the `games` table (no dependents exist yet) through a
  cascade-ready `deleteGames(ids)` path whose dependent-kind list is
  extended by the features that introduce the tables.
- Feature 016 must sync deletions as tombstones consistent with this
  rule; derived per-game insights and filter/search/selection state are
  never synced.

## 9. Fixture requirements

Deterministic Library fixtures covering Lichess and Chess.com, White and
Black sides, all six ADR-013 time-control categories, several dates
spanning all preset windows, several distinct players and results, and
empty/single/multi-game datasets — deliberately constructed so that each
filter (platform, side, every time control, each time-frame preset,
custom boundaries, search by each field, and the analysis-result
dimensions `analysis` / `hasBlunders` / `hasMissedTactics`) can be
verified independently and in combination. Fixtures run without network,
engine, or real user data.
