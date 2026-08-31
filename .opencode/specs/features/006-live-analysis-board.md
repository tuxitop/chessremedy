# Feature 006 — Live Analysis Board

## Goal

Provide a free-form analysis board where the user can play any legal move
on a starting position and receive **live** engine evaluation, multiple
principal-variation (PV) lines, and per-move classification (Feature 008,
ADR-023).

This primitive is reused by:

- **Feature 008** (Game Analysis) — the per-game review page.
- **Feature 012** (Puzzle Training) — the post-solve puzzle review.

The primitive must be testable in isolation with deterministic fixtures
(no network, no IndexedDB, no live Stockfish binary required for
component tests).

## Scope

In scope:

- Route `/analysis/live`.
- ChessRemedy `<Chessboard />` (Feature 002) — inherits resize,
  move list, navigation, persistence.
- Engine service (Feature 005) integration with live cancellation.
- Per-move classification (Feature 008, ADR-023).
- Multiple PV lines (configurable; default 3, max 5).
- Engine depth slider (default = `normal` profile from ADR-012 —
  depth 20, hash 64 MB, MultiPV 1 — overridable per session).
- Cancellable and restartable mid-analysis.
- Engine analysis cache (ADR-018) respected.

Out of scope:

- No automatic re-analysis on engine upgrade — ADR-020's opt-in applies.
- No puzzle / variation authoring — only user-driven board play.
- No game-level analysis pipeline (Feature 007). Feature 006 is for
  free-form analysis of an arbitrary starting position, not for
  walking through an imported game.

## Requirements

- The page loads with a starting position (FEN) and the user's
  configured default engine profile.
- The user can drag/click any legal move. After each move is played,
  the engine is invoked on the new position.
- The engine response drives:
  - `evalCp` / `evalMate` display
  - per-move classification glyph (ADR-023) overlaid on the move list
  - best move arrow on the board
  - the first N principal-variation lines (N = MultiPV setting)
- The depth slider and MultiPV selector are live controls; changing
  either re-runs the engine on the current position with the new
  parameters.
- A `Cancel` button aborts the running analysis. The UI returns to
  the pre-analysis state with no eval displayed.
- The engine profile / depth / MultiPV in effect are surfaced in the
  analysis panel (engineName, engineVersion, engineBuild, depth,
  MultiPV, hash) per ADR-020.
- Persisted analysis metadata per ADR-019 / ADR-020.
- The page is keyboard-accessible: every control reachable via Tab;
  Enter / Space activates; Arrow keys do **not** move pieces (piece
  movement is mouse/touch only — see AGENTS §13).

## Dependencies

- Feature 002 — chessboard wrapper, move list, navigation, resize.
- Feature 003 — chess domain (chessops Position, FEN, PGN).
- Feature 005 — Stockfish engine service.

## Acceptance Criteria

1. User can navigate to `/analysis/live` and see a starting position
   on the board with the engine ready.
2. User plays a legal move; the engine runs; the eval, classification,
   and PV lines appear within a reasonable budget.
3. User changes the depth slider mid-session; the engine re-runs
   the current position with the new depth.
4. User changes MultiPV; the engine re-runs with the new line count
   (capped at 5).
5. User clicks `Cancel` during a running analysis; the analysis
   terminates, the UI returns to the pre-analysis state.
6. Every engine response records engineName, engineVersion,
   engineBuild, profile, depth, MultiPV, hash.
7. A cached engine response from Feature 005's analysis cache
   (ADR-018) is reused when the same `(FEN, profile, engineName,
   engineVersion, engineBuild)` tuple is queried again.

## Future extensions

- Add a configurable per-position "engine for this position only"
  override (e.g., switch to the `tactical` profile at a critical
  branch).
- Add a "blunder check" that warns the user if their most recent
  move crosses a `wpLoss` threshold (ADR-023).

These are out of V1 scope.

## Tests

- Unit: the engine-service adapter honours cancellation (no eval
  emitted after `Cancel`).
- Unit: changing depth / MultiPV does not crash the worker.
- Component: `LiveAnalysisPage` renders the starting FEN, depth
  slider, MultiPV selector, PV panel, classification overlay.
- Component: classification glyph (?? ?, ! ?, !, ?!) is applied to
  the move-list entry for the user's most recent move.
- E2E: navigate to `/analysis/live`, make a legal move, assert eval
  appears within the test budget.
- E2E: cancel a running analysis and assert the UI returns to
  pre-analysis state.