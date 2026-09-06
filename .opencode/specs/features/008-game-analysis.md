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

A game is considered done — and the queue advances to the next queued
game/batch — the moment its job is persisted `completed` (every required
position analyzed). Feature-010's missed-tactic detection pass is derived data
that runs *detached* right after that persist: it never holds the batch or the
queue open, so a game that finished can never stall the games behind it.

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

# 12. Game Review is the Analysis Board

Game Review (`/games/:id/review`) is not a separate game viewer: it is the
**stored-review mode of the shared analysis board** (ADR-033) reused by the
Live Analysis board (Feature 006). It composes the shared
Chessground-10.1.1 `<Chessboard/>`, an evaluation bar, the chessops
move list, an engine-lines panel, Chessground arrows and analysis
controls. In stored mode it reads only persisted `MoveAnalysis` records —
no engine is started to render an analyzed game (ADR-004) — and in live
mode it runs the Feature-005 engine on the selected position.

Layout (adapted per device, see §20): evaluation bar beside the board;
move list; engine-lines/verdict panel; analysis controls. The evaluation
bar and per-move values show the evaluation **after** the selected move
from the persisted `MoveAnalysis` and stay synchronized with the board and
move list.

Below the board column, at board width, Review shows a **full-game
evaluation area chart** ("board footer"): one data point per analyzed ply
plotting White's winning-chance percentage across the game. The area below
the line is White's and the area above it is Black's, with a dashed
50%-equal reference drawn over both tones; clicking (or keyboard-activating)
a column seeks that ply. The Review **summary** sits below the move list,
beside the chart: each player's name heads a centered column of its own
statistics (accuracy — one decimal, slightly larger — then Best move, Good,
Inaccuracy, Mistake, Blunder counts; a Missed-tactics row appears for the
user once a Feature-010 detection pass completed), with metric labels in a
centred column between the two players. Counts are coloured by the canonical
Feature-009 palette (zeros of the negative classes read green; colour is
never the only signal). A completed analysis always offers an explicit
**Re-analyze** action; the summary also surfaces the Feature-010 detection
state (scanning / interrupted / failed / not scanned) instead of silently
omitting missed tactics (§ Feature 010).

The Review board is a **fully interactive analysis board** (mouse and
touch), identical to the Live Analysis board: the user can play any legal
move, use the board-settings overlay (orientation, legal-move hints,
coordinates, animation, drawable, interactive, board theme, piece set,
reset size, clear arrows), and draw Chessground arrows and circles on the
board. Playing an alternate move appends a transient variation or
continuation to the move list; the stored game/PGN and its persisted
`MoveAnalysis` records are never mutated (ADR-033).

# 13. Evaluation Bar & Per-Move Evaluations

- The Review evaluation bar reflects the persisted evaluation of the
  currently selected position/move, updates on navigation, distinguishes
  the side with the advantage, and handles mate scores consistently with
  the Stockfish evaluation model. It does not rerun the engine for stored
  positions.
- Persisted `MoveAnalysis` retains enough per-move engine information to
  display evaluations throughout the game: evaluation, mate score, search
  depth reached, principal variation, MultiPV lines, engine identity,
  profile and analysis version. Review never requests a new engine
  calculation merely to display an already persisted evaluation.
- Toggling live analysis on never dismisses the saved per-move evaluations:
  every ply keeps its stored value, and only plies whose position has a
  fresh live result this session show the live evaluation instead.

# 14. Engine Lines / MultiPV

- The engine panel shows the best line and, when the stored profile used
  MultiPV, the additional stored lines — each with its evaluation and
  principal variation. The number of shown lines depends on what the
  stored analysis contains; one line, multiple lines, no engine result and
  incomplete analyses are all handled gracefully.
- The engine-lines panel never renders an **empty area when the engine is
  off**: stored lines are shown only where they actually exist, otherwise
  the region is hidden (an idle hint invites live analysis). When the
  engine is on the region is always reserved — even before the first line
  arrives — so the panel never collapses while the engine thinks, and
  stored content is never padded with empty placeholder rows.
- Stored engine lines reuse the Feature-005/`MoveAnalysis` model; no
  second engine-result representation is invented.

# 15. Best-Move Arrows & Board Controls

- The board can visualize the engine's recommended move (and PV) as
  Chessground auto-shapes, updating when the selected position changes.
- The user can toggle engine suggestions on/off; arrows are never shown
  when suggestions are disabled.
- In live mode, live engine lines/evaluations/arrows update while the
  engine is thinking.
- The user can also draw their own Chessground arrows and circles (drawable
  is on by default) and clear them from the board-settings overlay. Drawn
  shapes are ephemeral presentation state and are never persisted.

# 16. Live Analysis on Review

- Live analysis is a distinct, explicit mode: it runs the Feature-005
  engine service against the currently selected position, is clearly
  labeled live, is cancellable, shows engine status/progress, and **never
  writes into persisted `MoveAnalysis`**. The user can return to the
  stored game analysis after using live analysis.
- Persisting live results happens only through an explicit
  analysis/re-analysis run, which creates a new analysis identity and never
  silently replaces a newer analysis with an older configuration
  (ADR-020, §4).
- While the engine is live, played/explored moves are classified
  **ephemerally** from the live evaluations (ADR-023): the move list shows
  the classification glyph and the active move gets the classification
  chip/start-end-square highlight, exactly like stored classifications.
  These ephemeral classifications are presentation-only and never overwrite
  the persisted `MoveAnalysis` classifications.

# 17. Move Classification & Mistake Review

- Each analyzed move that carries a visually emphasized classification
  displays its canonical glyph (`best`→`!!`, `inaccuracy`→`?!`,
  `mistake`→`?`, `blunder`→`??`); ordinary `good` moves are rendered
  without a classification glyph. Glyphs are read-only and come from the
  persisted `MoveAnalysis` via the Feature-009 presentation mapping;
  classifications are never recomputed in the view.
- The classification glyph of the selected move also renders as a small
  board chip anchored to the move's destination square, using the same
  SquareBadges style/formatting as the Playground's NAG badges. Ordinary
  (`good`) moves render no chip.
- An emphasized classification also tints the move's **start and end
  squares** with the classification colour (replacing the plain last-move
  highlight); ordinary (`good`) moves keep the default last-move
  highlight. Colour never carries information alone — glyphs, labels and
  the move-list text use the same classification colour/tone.
- For the user's inaccuracy/mistake/blunder (and later missed tactics),
  Review helps the user understand the mistake: what was played, the
  evaluation before/after, what should have been played, and the
  recommended continuation where the engine data allows it. Played move
  and recommended move are clearly distinguished; the recommended
  continuation can be inspected without mutating the stored game.
- Revealing engine recommendations is acceptable on the Review page
  (analysis/review). Puzzle/training behavior (Features 011–013) stays
  separate.

# 18. Move Navigation & Move Tree

- Navigation supports first/prev/next/last, clicking a move, board
  synchronization and keyboard shortcuts consistent with the shared
  analysis-board keyboard table; buttons are always present so keyboard
  is never the only path. The selected move is visually obvious and
  carries `aria-current="step"`.
- The move list uses the chessops move-tree representation. Engine
  variations are displayed separately from the played-game move tree
  (preview overlays); exploring an engine line never mutates the imported
  game.
- The user can play exploration moves directly on the board: a legal move
  that matches an existing continuation just navigates to it, anything else
  is appended to the **transient analysis tree** as a variation (rendered
  indented in the move list) or, from the end of the game, as a further
  mainline continuation. These appended moves are analysed live when the
  engine is on and are never written to the persisted game/PGN.

# 19. PGN Clocks & Time-Aware Data

- PGN `[%clk …]` annotations are parsed as structured per-move clock data
  (the mover's remaining time after the move) per `domain/clock.md` and are
  never rendered as ordinary comments. Missing clocks are omitted, not
  fabricated.
- The analysis model preserves clock data when available so future work can
  correlate classification, evaluation loss, game phase, remaining clock,
  move time and time-control category. No time-pressure analytics are
  implemented in V1.

# 20. Responsive & Accessibility

- Desktop: large board, evaluation bar, move list, engine lines, summary
  and controls. Tablet: the panel adapts without making the board unusably
  small. Mobile: a usable board and evaluation bar, move navigation, a
  compact move list, and collapsible/stacked sections for engine lines and
  summary — not a shrunk desktop layout. Board interaction supports mouse
  and touch.
- Accessibility: keyboard-accessible navigation, semantic move list,
  `aria-current="step"` on the selected move, accessible controls, visible
  focus, accessible summary/clock info, and no information conveyed by
  color alone.

# 21. Analysis Controls

- A coherent control area exposes: live analysis on/off, engine profile,
  MultiPV where supported, best-move arrow on/off, engine-line visibility,
  evaluation visibility, analysis/re-analysis and cancel-analysis where
  appropriate. Low-level engine settings belong in Settings, not the main
  Review interface.

# 22. Game Library Integration & Analysis Status

- The Game Library is the primary analysis entry point with context-aware,
  discoverable actions (no bottom-of-page dependency): selection/contextual
  toolbars and per-row actions expose Analyze, Review, Re-analyze, Delete
  and Cancel as applicable, without duplicating an action everywhere.
- Each game communicates its analysis state: `unanalyzed`, `queued`,
  `inProgress`, `completed`, `cancelled`, `failed`, and `outdated` (a
  persisted analysis predates a newer engine/analysis version and can be
  re-analyzed). Status is derived from persisted analysis/job state
  (analysis-status domain) and the persistent queue is the source of
  truth.
- `Re-analyze` is an explicit user-requested forced re-analysis: it
  clears/restarts the affected run, bypasses the ADR-018 position cache
  (so the engine genuinely re-runs), and persists the refreshed results
  (ADR-018/020). A completed analysis under the current configuration is
  only re-run through this explicit action — never automatically.

# 23. Progress

- Per-game progress: current status, current position/ply, total positions,
  percentage and the engine profile used. Batches report completed /
  analyzing / queued / failed counts and overall progress. An ETA is only
  shown when it can be estimated reliably. Progress stays visible after
  navigating away and returning.

# 24. Invalid & Incomplete States

The Review route handles: game missing; game present without analysis;
analysis queued/in-progress; analysis failed; analysis cancelled; and an
obsolete-analysis version. These are never rendered as a completed
analysis, and an appropriate action is offered where possible.

# 25. Testing

Automated tests cover: domain (time-control parse/classify/format across
dialects and boundaries; clock parsing), persistence (stored evaluation,
mate, depth, MultiPV, engine metadata, analysis version, restart/resume,
cancellation, re-analysis identity, deletion cascade with the engine cache
retained), the analysis service (positions submitted, results stored,
MultiPV preserved, failures, cancellation, progress; at least one
integration test against the real Feature-005 engine), batch behavior,
Game Library actions/statuses/progress, and Review (navigation, board
sync, evaluation bar from stored evals, per-move evals, engine lines,
best-move arrows, live mode without overwrite, classification display,
mistake/best-move comparison, clocks, responsive and accessibility).
At least one end-to-end test drives analyze → review → live → navigate and
one covers PGN clock import.

# 26. Acceptance Criteria

- Time-control parsing/categorization follow `domain/time-control.md`; a
  `5+5` game displays `5|5`, never a raw-seconds artifact; category and
  exact control are separate; statistics can distinguish categories.
- Game Library analysis actions are easy to discover and available without
  scrolling; batch and per-game progress is shown; analysis state persists
  across navigation/reload.
- Game Review uses the shared analysis-board components; it has an
  evaluation bar, persisted per-move evaluations, engine lines, toggleable
  best-move arrows, and a separate live-analysis mode that never silently
  overwrites stored analysis.
- The Review board is interactive and drawable with a working board-settings
  overlay: alternate moves appear as transient variations in the move list
  and are analysed live when the engine is on; drawn arrows/circles are
  ephemeral. Emphasized classifications highlight their start and end
  squares with the classification colour, and the engine-lines area is
  never an empty placeholder when the engine is off.
- Users can navigate the whole game efficiently; mistakes clearly show the
  played move and engine alternative; engine continuations can be
  inspected.
- PGN clock annotations are parsed and never shown as comments; clock data
  is preserved for future time-pressure analysis.
- Review works on desktop, tablet and mobile; all new behavior is tested;
  existing tests keep passing; no contradictory time-control or analysis
  rules remain across specs/ADRs.

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md`; `decisions/ADR-012`,
  `decisions/ADR-018`, `decisions/ADR-019`, `decisions/ADR-020`,
  `decisions/ADR-023`, `decisions/ADR-026`, `decisions/ADR-033`,
  `decisions/ADR-009`
- Domain: `domain/analysis-model.md`, `domain/classification.md`,
  `domain/game-phase.md`, `domain/game-model.md`, `domain/time-control.md`,
  `domain/clock.md`
- Research: `research/browser-stockfish.md`,
  `research/move-classification.md`

Feature dependencies: Features 002, 003, 004 (persistence), 005
(Stockfish service + profiles), 007 (Game Library entry point and
analysis status/actions). Feature 008 is independently implementable
and testable after those features; it never depends on Features 009/010
or later. Output (persisted `MoveAnalysis[]` with canonical
classification, phase and reserved missed-tactic contract) is consumed
by Features 009/010/011/014.
