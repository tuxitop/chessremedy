# Feature 006 — Live Analysis Board

## Goal

Provide a free-form analysis board where the user can play any legal move
on a starting position and receive **live** engine evaluation, multiple
principal-variation (PV) lines, an evaluation bar, and engine metadata.
Move classification is **not** computed here: classification glyphs
(Feature 009 / ADR-023) render only once Feature 009 supplies
classification output.

This primitive is reused by:

- **Feature 008** (Game Analysis) — the per-game review page.
- **Feature 012** (Puzzle Training) — the post-solve puzzle review.

Game Review (Feature 008) and this live board are the **same shared
analysis-board surface** (ADR-033): the live board is the "live analysis"
mode; Review adds a "stored review" mode that reads persisted
`MoveAnalysis` (evaluation bar, per-move evaluations, stored engine
lines/MultiPV, best-move arrows) without starting the engine. Live results
never overwrite stored analysis except through an explicit re-analysis
run.

The primitive must be testable in isolation with deterministic fixtures
(no network, no IndexedDB, no live Stockfish binary required for
component tests).

## Scope

In scope:

- Route `/analysis/live`. The primary nav "Analysis" targets it; `/analysis`
  remains a small hub landing that links to the live board (and later to
  game analysis, Feature 008).
- ChessRemedy `<Chessboard />` (Feature 002) — inherits resize,
  move list, navigation, promotion, persistence.
- Engine service (Feature 005) integration with live cancellation.
- A header row above the move list:
  `[engine toggle] [position eval] [engine version] [engine-settings ⚙] [board-settings ⚙]`
  and a second row showing the **reached** engine depth. Toggling the
  engine on starts live analysis of the current position.
- Engine settings popover with: engine (only shown/enabled when more than
  one engine is available), **profile** (auto-configures the remaining
  fields), **depth**, **search time in seconds**, **number of lines**
  (MultiPV, default 3, max 5), **threads**, **memory (hash)** and an
  **arrow mode** (best line only, or one arrow per line). Depth and search
  time are sliders; a compact two-column layout with inline help tooltips
  keeps the dialog short.
- Evaluation bar: a vertical bar between the board and the move list
  showing the position evaluation; the equal/zero point is marked with a
  fixed line in the middle. Rendered from the bottom player's perspective.
  The bar spans the full board/panel height.
- Evaluation text sign convention: the **bar's height is bottom-oriented**
  (it flips when the user plays Black) and carries **no numeric sign
  text**. Numeric evaluation **text** is a separate concern and is
  **White-positive everywhere**: the header `position-eval` text, the
  per-ply evaluation chips in the move list and the stored/live
  engine-lines panel share one helper (`formatWhiteEvaluation`), so `+`
  always means good for White — `+0.44` is White's advantage even when the
  user plays Black and the bar height points the other way. Game Review
  (Feature 008) follows the same convention (ADR-033).
- Engine-line arrows on the board are visually distinct from mouse-drawn
  arrows: the best line is drawn in a warm colour, and (in "all lines"
  mode) further principal variations are drawn as greyed arrows with
  decreasing opacity.
- Live search driven by **whichever limit is reached first**: the engine
  runs with the configured depth and the configured search time combined
  (`go depth N movetime M`), stopping at whichever is reached first. The
  "engine depth" readout shows the depth the engine actually reached.
- Lines and the evaluation bar update live with each reached depth — the
  freshest per-rank lines reported during the search are shown before the
  search completes.
- The engine-lines region is reserved as soon as the engine is enabled, so
  it never collapses while the engine is thinking (before the first line
  arrives the configured line slots are shown as stable placeholders); when
  the engine is off and there is no stored content the region is hidden
  rather than rendered as an empty area.
- The move list shows a greyed evaluation on the right of each ply's
  column once that position has an evaluation.
- Engine toggle is **on by default on `/analysis/live`** and **off by
  default in the playground** (the same engine UI is shared).
- Cancellable and restartable mid-analysis (position changes cancel the
  in-flight job and start the new position).
- Session engine-analysis cache (ADR-018 semantics) honored: repeated
  identical `(FEN, profile, engineName, engineVersion, engineBuild,
  effective depth, effective time, MultiPV)` queries are served from a
  session cache without contacting the worker. The persistent IndexedDB
  cache table is owned by Feature 008.
- Settings page "Engine" card that persists the default engine
  configuration (engine, profile, depth, search time, lines, threads,
  memory, arrow mode) used to initialise the live board and the
  playground. The Settings page styles the card to match the page (not the
  popover).
- Settings page "Board & pieces" card that persists default board theme,
  piece set, coordinates and piece animations, applied when a board opens.

Out of scope:

- No automatic re-analysis on engine upgrade — ADR-020's opt-in applies.
- No puzzle / variation authoring — only user-driven board play.
- No game-level analysis pipeline (Feature 008). Feature 006 is for
  free-form analysis of an arbitrary starting position, not for walking
  through an imported game.
- No move classification / glyph computation (Feature 009 / ADR-023) and
  no `missedTactic` handling (Feature 010).
- No persistent (IndexedDB) analysis cache — the ADR-018 table is Feature
  008 scope; Feature 006 uses an in-memory session cache behind the same
  seam.

## Requirements

- The page loads with a starting position (FEN) and the user's configured
  default engine configuration from the Settings page. Two source controls
  sit at the bottom of the page, styled consistently: a single-line **FEN**
  field and a multi-line **PGN** textarea (Ctrl/⌘+Enter loads). Loading a
  FEN clears the line; loading a PGN builds the game tree and lands on its
  final position.
- The user can drag/click any legal move. After each move is played, the
  engine is invoked on the new position (when the engine toggle is on).
- The engine response drives:
  - `evalCp` / `evalMate` display (header eval text + evaluation bar)
  - engine-line arrows on the board (distinct styling; see Scope)
  - the first N principal-variation lines (N = lines/MultiPV setting),
    updated live with each reached depth
- The move list shows a greyed per-ply evaluation on the right of each
  column whenever that position has an engine evaluation.
- The header toggle switches live analysis on/off; toggling off cancels
  any running analysis and removes the eval display.
- Changing profile, depth, search time, lines, threads, memory or arrows in
  the engine settings re-runs the engine on the current position with the
  new parameters.
- The engine version in the header shows engineName / engineVersion /
  engineBuild once known; the reached depth and effective settings
  (profile, depth, search time, lines, memory) are surfaced per ADR-020.
- The board remains interactive while the engine analyses.
- The page is keyboard-accessible: every control reachable via Tab;
  Enter / Space activates; Arrow keys do **not** move pieces (piece
  movement is mouse/touch only — see AGENTS.md UI requirements).

## Context

Required reading:

- `ARCHITECTURE.md` §5 (Engine)
- `decisions/ADR-012`, `decisions/ADR-018`, `decisions/ADR-019`,
  `decisions/ADR-020`, `decisions/ADR-009`
- `domain/analysis-model.md`
- `research/browser-stockfish.md`

Feature dependencies:

- Feature 002 — chessboard wrapper, move list, navigation, resize.
- Feature 003 — chess domain (chessops Position, FEN, PGN).
- Feature 005 — Stockfish engine service.
- Classification glyph semantics come from Feature 009 / ADR-023; this
  board renders glyphs only when classification output exists (Feature
  009 supplies it; none is computed here).

## Acceptance Criteria

1. User can navigate to `/analysis/live` and see a starting position on
   the board with the engine analysing it automatically (toggle on).
2. User plays a legal move; the engine runs; eval, evaluation bar and PV
   lines appear within a reasonable budget.
3. User changes the search time mid-session; the engine re-runs the
   current position.
4. User changes MultiPV (lines); the engine re-runs with the new line
   count (default 3, capped at 5).
5. User toggles the engine off (or cancels) during a running analysis;
   the analysis terminates and the UI returns to the idle state with no
   eval displayed.
6. Every engine response records engineName, engineVersion, engineBuild,
   profile, search time, depth, MultiPV, hash.
7. A cached engine response is reused when the same `(FEN, profile,
   engineName, engineVersion, engineBuild, effective depth, effective
   time, MultiPV)` tuple is queried again within the session.
8. The playground shows the same engine UI with the toggle off by default.

## Future extensions

- Add a configurable per-position "engine for this position only"
  override (e.g., switch to the `tactical` profile at a critical branch).
- Add a "blunder check" that warns the user if their most recent move
  crosses a `wpLoss` threshold (ADR-023) — depends on Feature 009.

These are out of V1 scope.

## Tests

- Unit: the engine-service adapter honours cancellation (no eval emitted
  after a cancel) and combines `go depth` with `go movetime` when both
  limits are set (whichever-first).
- Unit: changing search time / MultiPV does not crash the worker; the
  MultiPV override replaces the profile default and is clamped to 1–5.
- Unit: evaluation-bar mapping (cp → fraction, mate handling, orientation
  sign, equal-point marker) and engine preset resolution (incl. depth clamp
  and arrow-mode presets).
- Unit: engine-line arrow builder (first line coloured, later lines greyed,
  first/all modes) and per-ply move-list evaluation formatting (White
  perspective).
- Component: the analysis board renders the starting FEN, header
  (toggle / eval / engine version / engine-settings / board-settings),
  reached-depth readout, live per-rank lines that advance with progress,
  and the evaluation bar.
- Component: toggling the engine on issues an analysis for the current
  position; toggling off cancels and clears eval.
- Component: engine settings popover fields (profile, depth, search time,
  lines, threads, memory, arrows) auto-configure from the profile, expose
  help tooltips and sliders, and re-run the current position when changed;
  clamps are enforced.
- Component: MoveList renders per-ply evaluations in grey.
- E2E: navigate to `/analysis/live`, make a legal move, assert eval
  appears within the test budget.
- E2E: cancel/stop a running analysis and assert the UI returns to the
  pre-analysis (idle) state.
- E2E: load a multi-line PGN and assert the move list renders the game.
