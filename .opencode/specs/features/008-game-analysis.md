# Feature 008 — Game Analysis & Game Review

## Goal

Analyze imported chess games locally using the Stockfish analysis service and persist the resulting analysis.

The feature provides:

1. A resumable single-game and batch-analysis pipeline.
2. Persistent analysis results and analysis metadata.
3. Game-phase information.
4. Analysis status for the Game Library.
5. A per-game Game Review surface for inspecting analyzed games and their classifications.

The feature must be independently usable and testable without puzzle generation or later training features.

---

## Scope

### In scope

- Extracting analyzable positions from imported games.
- Submitting positions to the Feature 005 Stockfish analysis service.
- Single-game analysis.
- Batch analysis of multiple games.
- Persistent analysis queue state.
- Resuming interrupted analysis.
- Cancellation.
- Progress reporting.
- Persisting `MoveAnalysis` records.
- Analysis identity and versioning.
- Game-phase classification.
- Applying the canonical move-classification algorithm.
- Analysis status in the Game Library.
- Per-game Game Review UI.
- Deleting game-scoped analysis when a game is deleted.
- Retaining the independent FEN-keyed engine cache according to ADR-018.
- Automated tests for analysis and review behavior.

### Out of scope

- Importing games.
- Implementing Stockfish or its Web Worker.
- Creating a second engine service.
- Defining Stockfish profiles.
- Creating training puzzles.
- Puzzle solving/training.
- Spaced repetition or Woodpecker training.
- Opening repertoire management.
- Inline engine comments or annotations.
- User editing of classifications.
- Manual move classification.

---

# 1. Analysis Pipeline

For each selected game:

1. Validate that the game is analyzable.
2. Reconstruct the game from its initial position.
3. Extract the positions required by the analysis/classification model.
4. Submit positions to the Feature 005 Stockfish analysis service.
5. Collect engine results.
6. Apply the canonical move-classification algorithm.
7. Determine the game phase for each relevant move/position.
8. Persist `MoveAnalysis` records.
9. Persist analysis metadata.
10. Mark the game analysis as completed.

Feature 008 MUST use the existing Stockfish service.

It MUST NOT create another Stockfish worker, engine service, UCI parser, or engine lifecycle implementation.

Conceptually:

    Game
      ↓
    Position extraction
      ↓
    Stockfish Analysis Service
      ↓
    Engine results
      ↓
    Classification
      ↓
    Game phase
      ↓
    MoveAnalysis
      ↓
    Game Review / future statistics / future puzzles

---

# 2. Position Extraction

The analysis pipeline must reconstruct the complete game from its initial position.

For each relevant ply, the analysis data must be sufficient to determine:

- position before the move;
- move played;
- side to move;
- engine evaluation before the move;
- resulting position/evaluation;
- engine preferred continuation;
- relevant MultiPV lines when required by the selected analysis profile;
- classification;
- game phase.

The exact engine-result and `MoveAnalysis` schemas are defined by the analysis domain model.

The implementation must not analyze only moves that already appear suspicious.

Opponent moves may be analyzed when required for classification or tactical context, but user-facing mistake statistics are based on the user's moves.

---

# 3. Analysis Profiles

Feature 008 consumes the canonical profiles defined by Feature 005 /
ADR-012 (`fast`, `normal`, `tactical`, `deep`). Analyses of the user's
games typically use the configured default profile (`normal`) unless a
game/batch is explicitly run at `fast` or `deep`; the `tactical`
profile is reserved for tactical verification (Feature 010) and is not
used for bulk game analysis.

Feature 008 must record the profile used for each analysis.

Feature 008 must not redefine engine profile behavior.

---

# 4. Analysis Identity and Versioning

Every persisted analysis must identify the configuration that produced it.

At minimum, analysis metadata must contain:

- source game ID;
- analysis version;
- engine name;
- engine version;
- engine build;
- analysis profile;
- relevant engine configuration;
- creation timestamp;
- completion timestamp.

Two analyses of the same game produced using materially different configurations must be distinguishable.

An existing analysis must not silently be treated as equivalent to a newly requested analysis with a different analysis identity.

The canonical representation belongs in `domain/analysis-model.md`.

---

# 5. Persistent Analysis Queue

Analysis jobs are persistent.

Each job has one of:

- `queued`
- `inProgress`
- `completed`
- `cancelled`
- `failed`

A job identifies:

- game ID;
- requested analysis profile;
- analysis identity/version;
- creation time;
- start time when applicable;
- completion time when applicable;
- current progress;
- current ply/position when available;
- error information when failed.

## Restart behavior

If the application closes while analysis is running:

- completed results remain persisted;
- the job is recoverable;
- the job must not be reported as completed unless all required analysis is complete;
- the user can resume incomplete analysis;
- already-persisted completed work should not unnecessarily be repeated.

The persistence mechanism must be compatible with the project's local-first IndexedDB/Dexie architecture.

---

# 6. Cancellation

Users can cancel:

- queued jobs;
- active jobs;
- batches of queued/in-progress jobs.

Cancellation should propagate to the underlying Stockfish request where possible.

Already-persisted completed analysis must not be deleted merely because remaining analysis is cancelled.

A cancelled job must have an explicit `cancelled` state.

---

# 7. Batch Analysis

The Game Library is the primary entry point for batch analysis.

When the user selects multiple games and chooses `Analyze`:

- create one logical analysis job per selected game;
- process games through the analysis queue;
- expose aggregate progress;
- expose per-game progress;
- persist completed games independently;
- allow cancellation;
- allow interrupted batches to resume.

A failure in one game must not abort the entire batch.

Example:

    Game 1 → completed
    Game 2 → completed
    Game 3 → failed
    Game 4 → inProgress
    Game 5 → queued

Games 1, 2, 4, and 5 remain independent of Game 3's failure.

Retrying a failed game must not create duplicate active jobs for the same game and analysis identity.

---

# 8. Progress

Progress is available at:

- batch level;
- game level.

Where practical, game-level progress should represent analyzed positions/plies.

The UI must distinguish:

- queued;
- analyzing;
- completed;
- cancelled;
- failed.

Progress must survive page/component re-renders and must not depend on transient React component state.

---

# 9. MoveAnalysis

Each relevant analyzed move produces a persisted `MoveAnalysis` record.

The record must contain sufficient information to support:

- Game Review;
- move classification;
- game-phase statistics;
- blunder/mistake statistics;
- future puzzle generation;
- future missed-tactic detection;
- future tactical-motif analysis.

At minimum, the model identifies:

- game ID;
- ply;
- move number;
- side;
- played move;
- position/FEN or position reference;
- engine evaluation;
- preferred engine continuation;
- relevant MultiPV lines;
- classification;
- game phase;
- analysis identity/version.

The canonical schema is defined in:

    domain/analysis-model.md

Feature 008 must use that schema rather than creating a feature-specific representation.

---

# 10. Move Classification

Feature 008 applies the canonical classification algorithm defined by the chess domain.

Relevant specifications include:

- `domain/classification.md`
- classification research/decision documents.

Feature 008 MUST NOT invent separate classification thresholds.

The canonical move-classification output is one of:

- `best`
- `good`
- `inaccuracy`
- `mistake`
- `blunder`

`missedTactic` is **not** a sixth classification category. Per the
canonical domain model (ADR-023, `domain/classification.md`) it is a
separate boolean attribute on `MoveAnalysis` that Feature 008 **reserves
but does not compute**; Feature 010 (tactical detection) sets it from
this feature's persisted analysis once engine-verified detection runs.
Feature 008 therefore does not depend on Feature 010 or any later
feature, and its `MoveAnalysis` schema carries the reserved
`missedTactic` / `detectionVersion` fields so the contract exists before
analysis is produced (`domain/analysis-model.md`).

Classification must be deterministic for a fixed:

- position;
- played move;
- engine analysis;
- classification configuration/version.

If classification configuration changes, the resulting analysis must be distinguishable through the analysis version/identity.

---

# 11. Game Phase

Each analyzed relevant move/position is assigned one game phase:

- `opening`
- `middlegame`
- `endgame`

The canonical phase-classification algorithm belongs to the chess domain
(`specs/domain/game-phase.md`).

Feature 008 consumes that algorithm and persists the resulting phase with `MoveAnalysis`.

Feature 008 must not introduce a separate phase algorithm.

The persisted phase must allow future statistics and puzzle generation without rerunning phase detection.

---

# 12. Game Review

## Route

    /games/:id/review

The Review page provides a read-only view of an analyzed game.

It contains:

- chessboard;
- complete move tree/list;
- classification highlights;
- summary panel.

The page must use existing application components and domain models.

---

# 13. Chessboard

Use the shared ChessRemedy `<Chessboard />` component from Feature 002.

The chessboard implementation MUST remain based on:

    Chessground 10.1.1

Do not introduce another chessboard library or create a second board implementation.

The board must:

- display the current position;
- update when a move is selected;
- remain synchronized with the move list;
- display classification highlights where appropriate;
- work on desktop, tablet, and mobile.

---

# 14. Move List

Use the established chessops-based move-tree implementation from Feature 002 / ADR-028.

Display the complete game sequence.

Each move displays its classification glyph according to ADR-023:

- `??`
- `?`
- `?!`
- `!`
- `!!`

The glyph is read-only.

The user cannot manually change classification from Game Review.

Clicking a move:

1. selects that ply;
2. updates the board;
3. updates the active move;
4. sets `aria-current="step"` on the selected move.

Move navigation must remain synchronized between the move list and chessboard.

---

# 15. Review Summary

The summary panel displays, for the user's moves:

- classification counts: best; good; inaccuracy; mistake; blunder;
- missed-tactic count derived from the persisted `missedTactic`
  attribute (zero/absent until Feature 010 detection has run).

Opponent moves are shown for game context but are not included in the user's statistics.

The summary must distinguish the user's side from the opponent's side.

Summary values must be derived from persisted `MoveAnalysis` records.

The UI must not independently apply different classification rules.

---

# 16. Game Library Integration

The Game Library provides the primary analysis workflow.

## Analyze

The Library's selection toolbar exposes an `Analyze` action.

When activated:

- selected games are submitted to the analysis queue;
- one job is created per selected game;
- progress becomes visible;
- per-game analysis status becomes available.

If analysis is unavailable, the UI must display the actual unavailable/error state rather than pretending analysis occurred.

## Review

An analyzed game exposes a `Review` action.

A game without completed analysis must not appear reviewable as though analysis were complete.

## Analysis status

The Game Library can display:

- `unanalyzed`
- `queued`
- `inProgress`
- `completed`
- `cancelled`
- `failed`

Status must be derived from persisted analysis/job state.

---

# 17. Game Deletion

Game-scoped analysis belongs to the source game.

When a game is deleted:

- its `MoveAnalysis` records are deleted;
- its game-scoped analysis metadata is deleted;
- obsolete game-scoped analysis jobs are removed or transitioned according to queue rules;
- no orphaned game-analysis records remain.

The independent FEN/position-keyed Stockfish cache is NOT deleted.

The engine cache follows ADR-018 and is shared independently of individual games.

Future puzzle records derived from a game must follow the project's data-ownership/cascade rules.

The relationship should conceptually be:

    Game
      ├── MoveAnalysis       ← delete
      ├── Analysis metadata  ← delete
      └── Generated puzzles  ← future dependent data

    FEN Engine Cache
      └── independent        ← retain

---

# 18. Failure Handling

Analysis failures must be persisted with enough information to diagnose the failure.

Possible failures include:

- Stockfish unavailable;
- worker failure;
- invalid position;
- invalid/incomplete game;
- analysis timeout;
- storage failure;
- unexpected engine response.

A failed game must not prevent other games in the batch from completing.

The user must be able to retry failed analysis.

Retrying must not create duplicate active jobs for the same game and analysis identity.

---

# 19. Invalid and Incomplete States

The Review route must handle:

- game does not exist;
- game exists but has no analysis;
- analysis is queued;
- analysis is incomplete;
- analysis failed;
- analysis belongs to an obsolete analysis version.

These states must not be rendered as a completed analysis.

The UI must provide an appropriate action where possible.

Examples:

    No analysis:
    "Analyze this game to review its moves."

    Analysis failed:
    "Analysis failed. Retry analysis."

---

# 20. Responsive Design

Game Review must work on:

- desktop;
- tablet;
- mobile.

The layout must adapt rather than simply scale the desktop layout down.

The chessboard must remain usable at mobile widths.

The move list must remain accessible without making the board unusably small.

The summary must remain readable and accessible on narrow screens.

---

# 21. Accessibility

Game Review must provide:

- keyboard-accessible move navigation;
- semantic move-list structure;
- `aria-current="step"` for the selected move;
- accessible controls;
- visible focus states;
- accessible summary information;
- no information conveyed by color alone.

---

# 22. Testing

The feature is incomplete without automated tests.

## Domain/unit tests

Test:

- game reconstruction;
- position extraction;
- ply ordering;
- phase assignment;
- classification integration;
- analysis identity;
- analysis version handling;
- queue state transitions;
- cancellation;
- retry behavior;
- duplicate-job prevention;
- progress calculation.

## Persistence tests

Test:

- saving MoveAnalysis;
- retrieving analysis by game ID;
- persistence across application restart;
- partial analysis/resume;
- completed analysis persistence;
- game deletion cascading to game-scoped analysis;
- engine cache surviving game deletion.

## Analysis service integration tests

Use a deterministic fake/mock Stockfish service for most tests.

Verify:

- correct positions are submitted;
- engine results are stored;
- MultiPV results are preserved;
- engine failures are handled;
- cancellation is handled;
- progress updates correctly.

At least one integration test must exercise the real Feature 005 Stockfish service using a deterministic known position.

The test must verify that analysis can execute without blocking the UI.

## Batch tests

Test:

- single-game analysis;
- multi-game analysis;
- mixed success/failure;
- cancellation;
- restart/resume;
- already-completed analysis;
- retry;
- duplicate requests.

## Game Review component tests

Test:

- correct board position;
- complete move list;
- move selection;
- board synchronization;
- `aria-current="step"`;
- classification glyphs;
- summary counts;
- user/opponent separation;
- missing-analysis state;
- failed-analysis state;
- obsolete-analysis state.

## End-to-end test

At minimum:

    Fixture game
      ↓
    Start analysis
      ↓
    Analysis completes
      ↓
    Open Game Review
      ↓
    Select a move
      ↓
    Board updates
      ↓
    Classification appears
      ↓
    Summary counts are displayed

Use deterministic fixture games and deterministic engine responses where possible.

---

# 23. Acceptance Criteria

## Analysis

- [ ] A single imported game can be analyzed.
- [ ] Multiple selected games can be analyzed as a batch.
- [ ] Feature 005's Stockfish service is used.
- [ ] Analysis does not block the UI.
- [ ] Progress is visible.
- [ ] Analysis can be cancelled.
- [ ] Individual game failures do not abort a batch.
- [ ] Failed analysis can be retried.
- [ ] Analysis jobs survive application restart.
- [ ] Completed analysis survives application restart.
- [ ] Interrupted analysis can resume.
- [ ] Completed work is not unnecessarily repeated.
- [ ] Results contain engine/profile/version metadata.
- [ ] Results contain sufficient data for future puzzle generation.
- [ ] Game phase is persisted.
- [ ] Classification uses the canonical classification algorithm.

## Persistence

- [ ] MoveAnalysis records are persisted.
- [ ] Analysis can be retrieved by game ID.
- [ ] Analysis identity/configuration is identifiable.
- [ ] Game deletion removes game-scoped analysis.
- [ ] Game deletion retains the independent engine cache.

## Game Library

- [ ] Selected games can be submitted for analysis.
- [ ] Analysis status is visible.
- [ ] Batch progress is available.
- [ ] Completed games expose Review.
- [ ] Failed analysis exposes retry behavior.

## Game Review

- [ ] `/games/:id/review` loads an analyzed game.
- [ ] The complete game is displayed.
- [ ] The shared Chessground 10.1.1-based Chessboard is used.
- [ ] The established chessops move tree is used.
- [ ] Classification glyphs are displayed.
- [ ] Clicking a move updates the board.
- [ ] The selected move receives `aria-current="step"`.
- [ ] Summary counts match persisted MoveAnalysis records.
- [ ] User and opponent statistics are separated.
- [ ] Review works on desktop, tablet, and mobile.
- [ ] Missing, incomplete, failed, and obsolete analysis states are handled.

## Testing

- [ ] Domain logic is tested.
- [ ] Persistence is tested.
- [ ] Queue behavior is tested.
- [ ] Cancellation and retry are tested.
- [ ] Batch behavior is tested.
- [ ] Review behavior is component tested.
- [ ] At least one end-to-end analysis/review workflow is tested.
---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md`; `decisions/ADR-012`,
  `decisions/ADR-018`, `decisions/ADR-019`, `decisions/ADR-020`,
  `decisions/ADR-023`, `decisions/ADR-026`, `decisions/ADR-009`
- Domain: `domain/analysis-model.md`, `domain/classification.md`,
  `domain/game-phase.md`, `domain/game-model.md`
- Research: `research/browser-stockfish.md`,
  `research/move-classification.md`

Feature dependencies: Features 002, 003, 004 (persistence), 005
(Stockfish service + profiles), 007 (Game Library entry point and
analysis status/actions). Feature 008 is independently implementable
and testable after those features; it never depends on Features 009/010
or later. Output (persisted `MoveAnalysis[]` with canonical
classification, phase and reserved missed-tactic contract) is consumed
by Features 009/010/011/014.
