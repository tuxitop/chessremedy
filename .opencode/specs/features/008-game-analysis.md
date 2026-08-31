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
  annotations are explicitly out of scope per `PRODUCT.md §17`.

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