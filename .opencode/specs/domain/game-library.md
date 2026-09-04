# Game Library Domain Model

Owns the canonical, domain-side model for the Game Library page
(Feature 007 milestone 2). Pure and framework-agnostic: no React, no
Dexie, no network. Consumers: Feature 007 UI; later Feature 008 (bulk
analysis entry), 011 (puzzles-from-game), 014 (per-game insights),
016 (deletion tombstones).

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
};
```

Defaults: `all` everywhere, empty search. Single select per dimension in
V1; the model is not coupled to the control type (multi-select can be
added without redesign). Reuse `GameSource`, `TimeControlCategory`
(ADR-013), and `Color` from the existing domain — never duplicate them.

## 2. Filter semantics

- Time control, side, and platform are equality filters over stored
  normalized fields: `normalizedTimeControl`, `userColor`, `source`.
  The UI never parses time-control strings.
- Time control includes every ADR-013 category (bullet, blitz, rapid,
  classical, correspondence, unknown) plus All; `unknown`/correspondence
  are kept distinct and never merged.
- Multiple dimensions combine with AND.

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
    accuracy: number;                 // Feature 008/009/014
    analysisStatus: 'unanalyzed'|'inProgress'|'completed'|'failed'; // 008
    classificationCounts: {...};      // 009
    missedTactics: number;            // 010
    puzzleCount: number;              // 011
    masteredPuzzleCount: number;      // 012/013/014
  }>;
};
```

Insights are **read-only consumers** of values computed by Features
008–014; the Library never calculates them and renders only present
values.

Row actions are registered by capability:

```ts
type GameActionCapability = 'liveAnalysis'|'review'|'puzzles'|'delete';
```

V1 registers only `delete`; bulk **Analyze** is a disabled, labelled
placeholder until Feature 008 registers it. Future features register
their row action (open Live Analysis with the game, review, puzzles
from this game) without changing the Library layout.

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
custom boundaries, search by each field) can be verified independently
and in combination. Fixtures run without network, engine, or real user
data.
