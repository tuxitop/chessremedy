# Feature 007 — Game Import & Game Library

## Goal

Import the user's games from **Chess.com** and **Lichess** and provide a
**Game Library**: the central place to browse, search, filter, inspect,
select, prepare-for-analysis and delete imported games.

Platform names are canonical across the product and always presented in
this order: **Lichess, Chess.com** (see `domain/game-library.md`).

The feature has two milestones:

1. **Game Import** (delivered) — importing batches of games with duplicate
   detection, progress, errors, retry and resumability.
2. **Game Library** — the browse/manage page that this specification
   defines below.

---

## Milestone 1 — Game Import (delivered)

- Provider adapters (Chess.com PubAPI, Lichess public export).
- Batch import with pagination, duplicate detection (reuses Feature 004),
  progress, per-game errors, retry, and resumability across sessions.
- Import is filterable by **time frame** and **time-control category**
  (defaults: all time, all categories); filter changes trigger a safe
  re-sweep, identical filters resume incrementally.
- No engine analysis runs during import.
- Imported games have normalized metadata (ADR-013 time-control
  categories, stable `source:externalId` identity, `userColor`).

Implementation history and outstanding decisions are recorded in
`.opencode/plans/007-game-import.md`.

---

## Milestone 2 — Game Library

### Product requirements

The Game Library is the central management surface for imported games.
It must support:

- browsing imported games;
- searching games;
- filtering games;
- inspecting game metadata;
- selecting individual or multiple games;
- preparing games for analysis;
- deleting games;
- eventual bulk operations.

The page must work well with a few, hundreds, or thousands of games. The
design supports future features (puzzle counts, mastered counts, further
per-game accuracy) without a redesign: rows expose an **insights region**
and per-row **icon actions** through a capability registry
(`domain/game-library.md`). Bulk **Analyze / Re-analyze**, per-row
analysis actions and **Delete** are live (registered by Feature 008 /
Feature 010); the Library itself never computes analysis values.

### Layout

Desktop layout (conceptual):

- Page header: "Game Library" + an **Import** entry that opens the
  existing Feature 007 import panels (kept usable and reachable).
- **Search** field (top-level, always visible).
- **Filter bar**: Time, Time control, Side, Platform selects with an
  "All" default; a **Clear filters** action; custom date-range controls
  appear when Time = Custom. The analysis-result filters — **Analysis**
  (All / Analyzed / Not analyzed), **Has blunders** (All / Yes / No) and
  **Has missed tactics** (All / Yes / No) — are contributed by the
  Feature-010 milestone (`features/010-tactical-detection.md`, "Game
  Library Integration"); their canonical semantics and read model live in
  `domain/game-library.md` (§1, §2, §7) and they follow the same filter
  state/URL rules as every other dimension.
- **Results toolbar**: result count ("N of M games") and **Select all**.
- **Rows**: Lichess-style **card rows** on every breakpoint — the
  deliberate mobile card is the only row layout, with no column
  alignment and no table header on desktop. Each card stacks its
  fields: line 1 = players (with a "You" chip) + result chip + Your
  side; line 2 = date · platform · time control (verbatim + category) ·
  termination/moves. Cards keep `role=table/row/cell` semantics and
  accessible screen-reader labels (never colour-only), plus a selection
  checkbox. Below the card content each row carries:
  - per-row **icon actions** with accessible labels/tooltips: **Review**
    (link), **Re-analyze** (only when the game is analyzed/outdated),
    **Analyze/Retry** (unanalyzed/failed/cancelled), **Cancel**
    (queued/in-progress), and a per-row **Delete** that opens the
    existing confirmation dialog for that game;
  - a **full-width per-row progress bar** while the game is being
    analyzed;
  - the **insights strip** (Feature 010): colored, one-decimal accuracy
    and classification/missed-tactic counts that appear as soon as that
    game's analysis completes.
- The 🔬 **analysis glyph** appears in the top nav on the **Analysis**
  entry and on the row / analysis / review actions that lead into
  analysis surfaces.
- **Selection toolbar** (visible when ≥ 1 game is selected): selected
  count, **Analyze** and **Re-analyze** (enabled when the selection
  contains ≥ 1 analyzed/outdated game) and **Delete**.

Filters may collapse into a drawer/sheet on mobile. The card layout is
the same deliberate design on every breakpoint — never a shrunk table.

Layout decisions (placement, labels, card vs table) are ordinary UI
decisions and are not architecture decisions.

### Search

Search matches **any** of these fields, case-insensitively, on trimmed
text with interior whitespace collapsed:

- White player name;
- Black player name (covers the user and the opponent);
- external game id.

Searching by opening/ECO is **deferred** (openings are not stored on
`Game`). Combined with filters, results must satisfy every active
condition (AND across dimensions).

Defined behaviors:

- empty search: no effect;
- clearing search: restores the previous filtered set;
- partial matches: substring matches;
- case differences: ignored;
- whitespace: leading/trailing trimmed, runs collapsed;
- no results: distinct "no games match" state;
- search text changes: recompute the visible set without losing other
  filter state; **selection is cleared** on change.

### Time-frame filtering

Supported ranges (domain-owned presets, `domain/game-library.md`):

- All time; Today; Last 7 days; Last 30 days; Last 3 months;
  Last 6 months; Last year; Custom range.

Custom range provides start date, end date, validation (start ≤ end,
valid calendar dates), and clear/reset.

**Time zone and boundaries**: dates are applied in the **user's local
time zone**. `from` is inclusive from 00:00:00.000 local; `to` is
inclusive through the end of that local day. Presets ("Today", "Last N
…") are computed backwards from the local now. `playedAt` is compared as
the stored UTC instant. Domain resolution functions accept an explicit
`now` so behavior is deterministic; automated tests run under a pinned
time zone plus explicit-offset cases.

### Time-control filtering

- Single "All" default, plus each canonical category from ADR-013:
  bullet, blitz, rapid, classical, correspondence, unknown.
- Filters operate on `normalizedTimeControl` (stored normalized data),
  never on UI strings; no second enumeration is introduced.
- "Unknown/Other" and correspondence follow the canonical ADR-013 model
  (kept distinct; never silently merged).

### Player-side filtering

- All / White / Black, using the stored `userColor` (the normalized
  player identity associated with the game). No assumption that the
  user's name is identical between platforms.

### Platform filtering

- All / Lichess / Chess.com using the `GameSource` model
  (`GAME_SOURCE_LABELS`); no provider-specific logic in the UI.
- Platform presentation order is canonical: **Lichess, Chess.com**.

### Filter UX and state

A single canonical filter/search state (`domain/game-library.md`) drives
the page — not independent component state.

- active filters are visibly indicated;
- individual filters can be cleared;
- all filters can be cleared at once;
- filter/search state is **encoded in the URL query string** (back/forward,
  refresh, bookmark/share, debug);
- filters persist while navigating within the app (via the URL);
- after an import completes, the current filter/search state is kept and
  the visible set refreshes;
- after deleting games, the visible set refreshes and filters are kept;
- changing search text recomputes the visible set without losing filters;
- **selection is cleared whenever filters or search change** or games are
  deleted (preventing accidental bulk actions on hidden games).

### Sorting

V1 default sort: **newest first** (per stored `playedAt`). Additional
sort keys (rating, opponent, result, time control, date ascending) are
**explicitly out of scope for V1**; the sort model is a small comparator
registry so keys can be added without redesign.

### Game selection

- select / deselect an individual game;
- select all games in the current filtered result set;
- clear selection;
- selected-count indicator.

Selection is modeled as a set of game ids independent of the rendered
DOM rows, so it scales to large result sets and survives future
pagination/virtualization. Rules:

- filters change → clear selection;
- search changes → clear selection;
- games deleted → removed from the selection (deletion itself clears
  selection);
- future pagination/virtualization must not change these rules.

### Future analysis workflow

The page is the natural path toward analysis:

```
Game Library → Filter → Select → Analyze / Re-analyze → queue/progress → results → Review → puzzles
```

Bulk **Analyze** and bulk **Re-analyze** are active and operate on the
current selection (Feature 008 registers them over the selected games,
together with the per-row **Review** and per-row **Re-analyze**); the
analysis queue serializes requests — a new request queues behind the
running one and never aborts it (Feature 008 §5/§6). A game's insights
strip appears **as soon as that game's analysis completes** (the Library
refreshes when a batch advances, no manual reload), and games analyzed
before insights existed are **lazily backfilled** on Library load
(Feature 010). Row actions open Live Analysis / Review / "Puzzles from
this game" only when the owning feature is available (capability
registry). The insights region renders per-game accuracy, classification
counts, analysis status, and puzzles-from-game vs mastered counts
supplied by Features 008–014 — never computed by the Library page.

### Game deletion

- delete one game;
- delete multiple selected games;
- destructive operations require a confirmation that states the
  consequence;
- database state is updated transactionally;
- dependent-data behavior follows the ownership rule
  (`ARCHITECTURE.md` §7, `domain/game-library.md`): deleting a game
  removes its analyses and its generated puzzles/candidates
  (and, transitively, puzzle attempts and set membership) once those
  exist; the FEN-keyed engine cache is retained (ADR-018). V1 enforces
  only the games table through a cascade-ready `deleteGames` path.

### Empty, loading and error states

- **No games**: explain that no games have been imported; obvious Import
  action.
- **No matches**: clearly distinct from "no games exist"; offers clear
  filters.
- **Loading**: stable layout, no jumps.
- **Import in progress**: the page remains usable and shows import
  progress/status (existing import panels).
- **Error**: actionable, keeps filter/search state.

### Responsive & accessibility

- Lichess-style card rows on every breakpoint (see Layout); no desktop
  table / column header.
- Keyboard-accessible filters, search and selection; accessible
  checkboxes/buttons; visible focus states; semantic labels;
  confirmation dialog; screen-reader-friendly result counts
  (`aria-live`); never color-only information.

---

## Acceptance Criteria

1. The Game Library has a clear desktop and mobile layout.
2. Games can be searched.
3. Games can be filtered by time frame.
4. Custom date ranges work (validation, clear, inclusive local-day
   bounds).
5. Games can be filtered by time control (every ADR-013 category).
6. Games can be filtered by player side.
7. Games can be filtered by platform (Lichess, Chess.com).
8. Filters can be combined (AND semantics).
9. Filters can be individually cleared.
10. All filters can be cleared.
11. Search and filters work together.
12. Result counts update correctly.
13. Empty states are distinct and useful (no games vs no matches).
14. Individual games can be selected.
15. Multiple games can be selected.
16. Select-all operates on the current filtered result set.
17. Selection clears predictably when filters/search change or games are
    deleted.
18. Bulk **Analyze / Re-analyze** acts on the current selection with
    visible queue/progress; per-row icon actions (Review / Analyze /
    Re-analyze / Cancel / Delete) are discoverable and accessible.
19. Individual games can be deleted.
20. Multiple games can be deleted.
21. Destructive deletion requires confirmation.
22. The data model supports dependent puzzle deletion/invalidation
    (ownership rule documented in `ARCHITECTURE.md` §7 and
    `domain/game-library.md`).
23. Mobile behavior is deliberately designed, not a shrunk desktop UI.
24. All important behavior is covered by automated tests on deterministic
    fixtures (see below).
25. Filtering/searching/selection remain practical for large collections
    (DB pushdown + windowed rows; see `domain/game-library.md`).

## Testing & fixtures

- Unit/domain tests: filter predicates, local-timezone date-range logic
  (each preset, custom, invalid, boundary, clear), time-control (all
  six categories), platform, side, search matching, combined filtering,
  selection logic, deletion rules.
- Component tests: filter controls, search, selection, result counts,
  empty/no-match/loading/error states, delete dialog (confirm/cancel),
  import-in-progress.
- End-to-end critical workflow: open Library → filter → verify →
  search → select → clear/change filters → delete a selected game →
  verify it disappears.
- Deterministic fixture dataset covering Lichess and Chess.com, White and
  Black, all six time-control categories, varied dates/players/results,
  constructed so each filter is independently verifiable
  (`domain/game-library.md` fixture requirements).

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md`; `decisions/ADR-001`,
  `decisions/ADR-009`, `decisions/ADR-013`, `decisions/ADR-018`,
  `decisions/ADR-028`
- Domain: `domain/game-model.md`, `domain/game-library.md`
- Research: `research/game-import.md`

Feature dependencies: Features 001, 003, 004 (persistence + duplicate
detection). Consumers/contributors of the Library surface: Features
008–016 (see each feature spec for its Game Library integration).
