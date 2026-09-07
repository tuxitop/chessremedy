# ChessRemedy Architecture

> This file is **current architecture truth**. Decision rationale and
> history live in ADRs — current decisions are indexed in
> `.opencode/DECISIONS.md`, superseded ones in `.opencode/specs/history/`.

## 1. Architecture Style

ChessRemedy is a local-first single-page application.

Primary runtime:

Browser.

Primary persistence:

IndexedDB.

Primary computation:

Browser Web Workers.

Deployment:

Static hosting/PWA.

No backend is required for the core application.

---

## 2. Technology

Core:

- React
- TypeScript
- Vite

Chess:

- `chessops@^0.15.1` (rules, position, FEN, PGN — including
  variations, NAGs, and comments; ADR-028)
- `@lichess-org/chessground@10.1.1` or higher version (board
  rendering; ADR-002, ADR-014)
- Move list is a custom React component over `chessops/pgn` (ADR-030;
  `@lichess-org/pgn-viewer` was dropped)

Engine:

- Stockfish WASM
- Web Worker

Persistence:

- IndexedDB
- Dexie

Puzzle training:

- V1 uses deterministic in-domain cycle-based tactical training
  (training sets, cycles, attempts) with no scheduler library
  (ADR-031). A future individual scheduler (e.g. FSRS) is an
  application-layer option and is not a V1 dependency.

Visualization:

- Recharts (ADR-010)

Testing:

- Vitest + Testing Library + happy-dom (default) / jsdom (on-demand) +
  fake-indexeddb + MSW (installed by its consumer feature, ADR-009).
  Playwright for browser-level integration tests. Exact versions follow
  the Dependency policy in `AGENTS.md` (latest stable).

---

## 3. Layers

### Presentation

React components and pages.

Responsible for:

- rendering
- user interaction
- navigation
- presentation state

Must not contain core chess-analysis algorithms.

### Application

Coordinates use cases.

Examples:

- import games
- analyze game
- generate puzzles
- run a training cycle
- synchronize data

### Domain

Contains business rules.

Examples:

- move classification
- tactical detection
- puzzle generation
- cycle training state (sets, cycles, attempts)
- statistics

Domain code should be deterministic wherever possible.

### Infrastructure

Contains:

- IndexedDB/Dexie
- Stockfish worker
- Chess.com adapter
- Lichess adapter
- Dropbox adapter
- browser APIs

Infrastructure must not leak directly into domain logic.

---

## 4. Chessboard

Chessground is wrapped by a reusable component.

Application code should interact with the wrapper rather than directly
constructing Chessground instances throughout the application.

`chessops` is responsible for legal chess state and PGN parsing.

Chessground is responsible for visual interaction.

The chessboard supports user-controlled resizing on desktop via a
drag handle. The chosen size is persisted in localStorage. Mobile
devices use fluid container sizing without a resize handle.

---

## 5. Engine

The UI communicates with an engine service.

The engine service communicates with a Web Worker.

The Worker communicates with Stockfish.

The UI must never synchronously execute engine analysis.

Engine jobs must support:

- queueing
- cancellation
- progress
- completion
- failure
- resumability

Full-game-analysis **runs** (Feature 008) are serialized on the shared
analysis service: a new analyze request issued while a run is in progress
**queues** behind it and starts only when the running run completes — it
never aborts the running run; cancellation of a run is explicit (Feature
008 §5/§6). Engine *jobs* inside a run remain individually cancellable.

A FEN-keyed analysis cache (ADR-018) lives in IndexedDB. The
classification domain (Feature 009) consumes `MoveAnalysis` records
that may carry WDL (ADR-019). Engine version upgrades follow a
lazy, opt-in policy (ADR-020).

---

## 6. Analysis Pipeline

Game:

    Game
      ↓
    Position extraction
      ↓
    Engine analysis
      ↓
    MoveAnalysis[]
      ↓
    Classification
      ↓
    Tactical detection
      ↓
    Puzzle candidates
      ↓
    Puzzle verification
      ↓
    Puzzle

The classification step uses ADR-023 (move-classification thresholds).
The tactical-detection step runs as a two-stage pipeline defined in
ADR-026 (tactical verification pipeline). The puzzle generator and
verification step use the engine profiles defined in ADR-012
(Stockfish WASM build) and the position-keyed cache defined in
ADR-018 (engine analysis cache).

Feature 008 (Game Analysis) performs classification and game-phase
assignment **while producing `MoveAnalysis`** using the canonical domain
rules (`specs/domain/classification.md`, `specs/domain/game-phase.md`);
the "Classification" stage in the diagram is that in-pipeline domain
step, not a later feature. Tactical detection (Feature 010) then
consumes the persisted `MoveAnalysis` records (Stage 1 needs no new
engine work) and Feature 011 consumes verified candidates. Feature 008
does not depend on Features 009/010/011.

### Analysis board (stored review + live analysis)

Game Review (Feature 008) and the Live Analysis board (Feature 006) are
the same shared **analysis-board** surface (ADR-033): Chessboard
(Chessground 10.1.1), evaluation bar, chessops move list, engine-lines
panel, Chessground arrows, and analysis controls. Two modes over one
component:

- **Stored review** reads persisted `MoveAnalysis` only — evaluation bar,
  per-move evaluations, engine lines/MultiPV, best-move arrows and
  classifications come from stored records; no engine is started to
  render them (ADR-004).
- **Live analysis** runs the Feature-005 engine service on the selected
  position, is labeled live, cancellable, and never overwrites persisted
  `MoveAnalysis`. Persisting live results happens only through an explicit
  analysis/re-analysis run with a new identity (ADR-019/020, §9).

Exploration (best-line/PV previews, "show the recommended move") is
non-destructive: it never mutates the stored `Game`/PGN. Evaluation
semantics are unified: the bar and per-move values show the evaluation
**after** the selected move; classifications are never recomputed in the
view. Engine results and stored lines share the Feature-005/`MoveAnalysis`
model (no second engine representation).

---

## 6a. Analytics Layer

Statistics are calculated in the **domain** layer (Feature 014 — Game
Analysis History & Statistics) and consumed read-only by the dashboard
(Feature 015). The dashboard must not perform statistical
calculations.

The analytics layer is responsible for:

- aggregating analyzed games and reviews into time-controlled,
  platform-controlled and phase-controlled metrics
- producing trend data suitable for visualization
- exposing sample size for every aggregate
- distinguishing empty, zero and "insufficient data" states

All aggregates must respect the canonical time-control categories
(ADR-013) and must never silently combine different time controls.

Per-move and per-game accuracy use the Lichess accuracy formula
defined in ADR-024 (move accuracy formula). Per-puzzle difficulty
uses the formula defined in ADR-025 (puzzle difficulty formula).

## 7. Storage

IndexedDB is the source of truth.

Dexie provides the database abstraction.

Persistent entities include:

- games
- moves
- analyses
- analysis summaries
- puzzle candidates
- puzzles
- training sets
- training cycles
- puzzle attempts
- import jobs
- analysis jobs
- application settings
- sync metadata

Database schema must be versioned. The schema is currently **v7**
(additive): v4 added the analysis tables; v5 adds the structured
time-control value (base/increment/days/estimate/display, see
`domain/time-control.md`) to the games row while retaining the verbatim
`timeControl` string and the indexed `normalizedTimeControl` category;
v6 backfills the Library row's full-move count and board-detectable
end; v7 adds the Feature-010 game-scoped derived tables `analysisSummaries`
(per-analysis summary rows) and `puzzleCandidates` (verified missed-tactic
candidates).

### Data ownership & deletion

Derived data is owned by its source game and is removed with it:

```
Game
 ├── Analysis          (per game)
 ├── Analysis Summary  (per game)
 ├── Puzzle Candidate
 └── Puzzle(s)
       └── Puzzle attempts / training-set membership
```

Deleting a game deletes its game-scoped derived rows (analyses, puzzle
candidates, puzzles) and transitively puzzle attempts and set
membership once those tables exist. The **engine analysis cache
(ADR-018) is exempt**: it is keyed by position FEN (positions are shared
across games) and is a performance cache, not game-scoped state — it is
never purged on game deletion. Feature 016 syncs deletions as tombstones
consistent with this rule; derived per-game insights and
filter/search/selection state are never synced. The full rules live in
`specs/domain/game-library.md`.

### Game Library data flow

The Game Library (Feature 007) browses stored games without loading the
whole table into the UI when it can be avoided:

1. The page owns a single canonical filter/search/selection state
   (`specs/domain/game-library.md`), serialized to the URL query string.
2. Coarse equality filters (platform, time control, side) and the local
   time-zone date window are pushed down to Dexie through the games
   repository as indexed `GameQuery` predicates (source /
   normalizedTimeControl / playedAt leading index).
3. Free-text name search runs as a bounded in-memory pass over the
   pushed-down summaries; results are windowed for rendering.
4. Selection is a set of game ids independent of rendered rows; it is
   cleared whenever filters/search change.
5. Per-row insights and row actions are capability-registered by later
   features (008 bulk/review, 011 puzzles-from-game, 014 accuracy) and
   never force a Library redesign.

Schema stays additive (currently v7). Indexed pagination or
virtualization is introduced behind these seams when a measured dataset
demands it — the model does not couple the Library to "render every row".

---

## 8. Synchronization

Synchronization operates above local persistence.

The conceptual architecture is:

    Local Database
          ↕
    Sync Engine
          ↕
    Sync Provider
          ↕
       Dropbox

The domain must not depend on Dropbox.

V1 sync sub-decisions are recorded in:

- ADR-008 — provider-independent synchronization architecture
- ADR-015 — Dropbox App Folder scope
- ADR-016 — gzipped JSON envelope file format
- ADR-017 — JSON-level merge with last-write-wins fallback

---

## 9. Versioning

Analysis and classification are versioned.

Persist:

- engine name
- engine version
- analysis version
- classification version
- puzzle-generation version
- statistics-aggregation version

If an algorithm changes, existing records must be identifiable as having
been generated by an older version.

---
## 10. Performance

Potentially expensive operations include:

- Stockfish analysis
- large imports
- puzzle generation
- statistics aggregation

These must not freeze the UI.

Use:

- Web Workers
- incremental processing
- batching
- resumable jobs
- memoization/caching where appropriate

---

## 11. Offline

The application should continue functioning when offline for:

- viewing imported games
- viewing analysis
- solving available puzzles
- running and resuming training cycles
- local analysis
- dashboard statistics

External game imports and synchronization require network access.

---

## 12. Future Extensions

Architecture should permit additional providers:

    GameSource
      ├── ChessCom
      └── Lichess

and:

    SyncProvider
      └── Dropbox

without changing domain logic.

Future opening-training functionality should reuse the same chessboard,
game-state and training infrastructure (training sets, cycles and
attempt history). V1's training data model deliberately does not commit
to an individual scheduling strategy: puzzle training currently uses
cycle-based training, and a future per-puzzle scheduler (e.g. FSRS) can
be layered on without changing the immutable puzzle model (ADR-031).

The conceptual boundary is:

    Puzzle
      ↓
    Training Strategy
      ├── Cycle Training (V1)
      └── Individual Scheduler (future)
