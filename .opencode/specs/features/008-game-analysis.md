# Feature 008 — Game Analysis

## Goal

Analyze imported games using Stockfish.

## Requirements

- position extraction
- analysis queue
- resumability
- progress
- cancellation
- stored MoveAnalysis
- game phase
- analysis version

## Game Review UI

In addition to the backend analysis pipeline above, this feature ships
the per-game **review** surface.

- Route: `/games/:id/review`.
- Composition: ChessRemedy `<Chessboard />` (Feature 002) + chessops
  move-list tree (Feature 002 / ADR-028) + classification highlights
  on the board + summary panel.
- Each move in the move list shows a classification glyph (`??`, `?`,
  `?!`, `!`, `!!`) per ADR-023. The glyph is read-only — the user
  cannot re-classify a move from the UI.
- A summary panel shows the count of `best`, `good`, `inaccuracy`,
  `mistake`, `blunder`, and `missedTactic` for the analyzed game.
- Clicking any move in the move list seeks the board to that ply and
  sets `aria-current="step"` on the move.
- The summary panel must distinguish the user's color from the
  opponent's color. (Only the user's moves are summarized; the
  opponent's moves are shown for context.)
- Future extension (not in V1): inline move comments and engine
  annotations are explicitly out of scope for V1 per `specs/PRODUCT.md`
  and `Feature 009` scope.

## Game Library integration

Feature 007's Game Library is the analysis entry point:

- The bulk **Analyze** action in the Library selection toolbar activates
  over the **selected** games and enqueues them for batch analysis with
  per-game queue/progress (resumable, cancellable per Feature 005/006
  semantics). In V1 (Feature 007 alone) this action is a disabled,
  clearly labelled placeholder — never faked.
- The per-row **Review** action routes to `/games/:id/review` and is
  registered through the Library row-action capability registry
  (`domain/game-library.md`).
- A per-game **analysis-status insight** (`unanalyzed`, `inProgress`,
  `completed`, `failed`) is supplied to Library rows by this feature and
  rendered in the rows' insights region.
- Deleting a game removes its game-scoped analyses per the ownership
  rule (`ARCHITECTURE.md` §7); the FEN-keyed engine cache is retained
  (ADR-018).

## Acceptance Criteria

A batch of games can be analyzed.

Closing and reopening the application does not lose completed analysis.

For the Game Review UI:

- A user can navigate to `/games/:id/review` for any analyzed game.
- The board and move list render the game's full sequence.
- The summary panel counts match the classification counts in the
  persisted `MoveAnalysis[]` records.
- Clicking a move in the move list seeks the board and updates
  `aria-current`.
- The review works on desktop, tablet, and mobile viewports.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `decisions/ADR-012`, `decisions/ADR-018`,
  `decisions/ADR-019`, `decisions/ADR-020`, `decisions/ADR-023`,
  `decisions/ADR-026`, `decisions/ADR-009`
- Domain: `domain/analysis-model.md`, `domain/classification.md`,
  `domain/game-model.md`, `domain/game-library.md`
- Research: `research/browser-stockfish.md`,
  `research/move-classification.md`

Feature dependencies: Features 002, 003, 005, 006; consumes
classification/missed-tactic output from Features 009/010.
