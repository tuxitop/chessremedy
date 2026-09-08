# ChessRemedy Architecture

> This file is **current architecture truth**. Decision rationale and
> history live in ADRs — current decisions are indexed in
> `.opencode/DECISIONS.md`, superseded ones in `.opencode/specs/history/`.

## 1. Architecture Style

ChessRemedy is a **local-first single-page application**: browser UI,
IndexedDB persistence, browser Web Workers for computation, static/PWA
hosting. No backend is required for the core application.

## 2. Technology

- Core: React, TypeScript, Vite.
- Chess: `chessops@^0.15.1` (rules, position, FEN, PGN incl. variations,
  NAGs, comments; ADR-028); `@lichess-org/chessground@10.x >= 10.1.1`
  (board; ADR-002, ADR-014); the move list is a custom React component over
  `chessops/pgn` (ADR-030).
- Engine: Stockfish WASM in a Web Worker.
- Persistence: IndexedDB via Dexie.
- Puzzle training: V1 deterministic in-domain **cycle-based** tactical
  training (sets, cycles, attempts) — no scheduler library (ADR-031). A
  future per-puzzle scheduler (e.g. FSRS) is an application-layer option.
- Visualization: Recharts (ADR-010).
- Testing: Vitest + Testing Library + happy-dom (default)/jsdom
  (on-demand) + fake-indexeddb + MSW (installed by its consumer feature,
  ADR-009); Playwright for browser tests. Versions follow the Dependency
  policy in `AGENTS.md`.

## 3. Layers

- **Presentation** — React components/pages: rendering, interaction,
  navigation, presentation state. Must not contain core chess-analysis
  algorithms.
- **Application** — coordinates use cases (import, analyze, generate
  puzzles, run a training cycle, synchronize).
- **Domain** — business rules (move classification, tactical detection,
  puzzle generation, cycle-training state, statistics). Deterministic
  wherever possible.
- **Infrastructure** — IndexedDB/Dexie, Stockfish worker, provider
  adapters (Chess.com, Lichess, Dropbox), browser APIs. Must not leak
  directly into domain logic.

## 4. Chessboard

Chessground is wrapped by a **reusable component**; application code uses
the wrapper, never raw Chessground instances. `chessops` owns legal chess
state and PGN parsing; Chessground owns visual interaction. Desktop
supports user-controlled resizing via a drag handle (persisted in
localStorage); mobile uses fluid container sizing without a handle.

## 5. Engine

UI → engine service → Web Worker → Stockfish. The UI never synchronously
executes engine analysis. Jobs support queueing, cancellation, progress,
completion, failure, and resumability.

Full-game-analysis **runs** (Feature 008) serialize on the shared analysis
service: a request issued during a run queues behind it and starts when the
running run completes — it never aborts it; run cancellation is explicit
(Feature 008 §5/§6). Engine *jobs* inside a run stay individually
cancellable.

A FEN-keyed analysis cache (ADR-018) lives in IndexedDB. Classification
(Feature 009) consumes `MoveAnalysis` that may carry WDL (ADR-019). Engine
version upgrades are lazy and opt-in (ADR-020).

## 6. Analysis Pipeline

```
Game → Position extraction → Engine analysis → MoveAnalysis[] →
Classification → Tactical detection → Puzzle candidates →
Puzzle verification → Puzzle
```

- Classification uses ADR-023 thresholds. Tactical detection is the
  ADR-026 two-stage pipeline; the puzzle generator and verification step
  use the ADR-012 engine profiles and ADR-018 position-keyed cache.
- Feature 008 performs classification and game-phase assignment **while
  producing `MoveAnalysis`** (canonical rules in
  `specs/domain/classification.md`, `specs/domain/game-phase.md`) — that
  in-pipeline step is the diagram's "Classification", not a later feature.
  Feature 010 consumes persisted `MoveAnalysis` (Stage 1 needs no new
  engine work); Feature 011 consumes verified candidates. Feature 008 does
  not depend on Features 009/010/011.

### Analysis board (stored review + live analysis)

Game Review (Feature 008) and Live Analysis (Feature 006) share one
**analysis-board** surface (ADR-033): Chessboard, evaluation bar, chessops
move list, engine-lines panel, arrows, and controls. Two modes over one
component:

- **Stored review** reads persisted `MoveAnalysis` only — bar, per-move
  values, lines/MultiPV, arrows, classifications all come from stored
  records; no engine starts to render them (ADR-004).
- **Live analysis** runs the Feature-005 engine service on the selected
  position, is labeled live and cancellable, and never overwrites persisted
  `MoveAnalysis`. Persisting live results only happens via an explicit
  analysis/re-analysis run with a new identity (ADR-019/020, §9).

Exploration (best-line previews, "show the recommended move") is
non-destructive. Evaluation semantics are unified: the bar and per-move
values show the evaluation **after** the selected move; classifications
are never recomputed in the view. Engine results and stored lines share the
Feature-005/`MoveAnalysis` model (no second engine representation).

## 6a. Analytics Layer

Statistics are computed in the **domain** layer (Feature 014) and consumed
read-only by the dashboard (Feature 015), which never calculates.
Aggregates: analyzed games/reviews into time-control, platform- and
phase-controlled metrics; trend data; sample size per aggregate; distinct
empty/zero/"insufficient data" states. All aggregates respect the canonical
time-control categories (ADR-013) and never silently combine different time
controls. Accuracy uses ADR-024; puzzle difficulty uses ADR-025.

## 7. Storage

IndexedDB is the source of truth, accessed via Dexie. Persistent entities:
games, moves, analyses, analysis summaries, puzzle candidates, puzzles,
training sets, training cycles, puzzle attempts, import jobs, analysis
jobs, application settings, sync metadata.

The schema is **versioned, currently v8** (additive): v4 added the
analysis tables; v5 added the structured time-control value
(base/increment/days/estimate/display, `domain/time-control.md`) to the
games row while retaining the verbatim `timeControl` string and the indexed
`normalizedTimeControl` category; v6 backfills the Library full-move count
and board-detectable end; v7 adds the Feature-010 game-scoped derived
tables `analysisSummaries` and `puzzleCandidates`; v8 adds the Feature-011
`puzzles` table.

### Data ownership & deletion

Derived data is owned by its source game and removed with it (analyses,
analysis summaries, puzzle candidates, puzzles, and transitively puzzle
attempts/set membership once those tables exist). The **engine analysis
cache (ADR-018) is exempt** — it is position-keyed, shared across games,
and a performance cache, so it is never purged on game deletion. Feature 016
syncs deletions as tombstones consistent with this rule; derived per-game
insights and filter/search/selection state are never synced. Full rules:
`specs/domain/game-library.md`.

### Game Library data flow

The Library (Feature 007) avoids loading the whole table when possible:
(1) one canonical filter/search/selection state serialized to the URL;
(2) coarse equality filters (platform, time control, side) and the local
date window pushed down to Dexie as indexed `GameQuery` predicates
(source / normalizedTimeControl / playedAt leading index); (3) free-text
name search as a bounded in-memory pass over pushed-down summaries,
windowed for rendering; (4) selection is an id set independent of rendered
rows, cleared when filters/search change; (5) per-row insights/actions are
capability-registered by later features and never force a redesign.
Schema stays additive; pagination/virtualization slots in behind these
seams when a measured dataset demands it.

## 8. Synchronization

Synchronization operates above local persistence:

```
Local Database
      ↕
Sync Engine
      ↕
Sync Provider
      ↕
   Dropbox
```

The domain must not depend on Dropbox. V1 sync sub-decisions: ADR-008
(provider-independent architecture), ADR-015 (Dropbox App Folder scope),
ADR-016 (gzipped JSON envelope), ADR-017 (JSON-level merge with
last-write-wins fallback).

## 9. Versioning

Analysis and classification are versioned. Persist engine name/version,
analysis version, classification version, puzzle-generation version,
statistics-aggregation version. If an algorithm changes, existing records
must be identifiable as generated by an older version.

## 10. Performance

Stockfish analysis, large imports, puzzle generation, and statistics
aggregation must not freeze the UI. Use Web Workers, incremental
processing, batching, resumable jobs, and memoization/caching where
appropriate.

## 11. Offline

The app continues to work offline for: viewing imported games, viewing
analysis, solving available puzzles, running/resuming training cycles,
local analysis, and dashboard statistics. Imports and sync need network.

## 12. Future Extensions

Architecture permits additional providers without touching domain logic:

```
GameSource
  ├── ChessCom
  └── Lichess

SyncProvider
  └── Dropbox
```

Future opening-training reuses the chessboard, game-state and training
infrastructure. V1's training model deliberately does not commit to an
individual scheduler (ADR-031):

```
Puzzle
  ↓
Training Strategy
  ├── Cycle Training (V1)
  └── Individual Scheduler (future)
```
