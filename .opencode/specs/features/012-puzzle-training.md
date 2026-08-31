# Feature 012 — Puzzle Training

## Goal

Allow the user to solve personalized puzzles.

## Requirements

- responsive Chessground board
- arrows
- hints
- retry
- restart
- start
- previous
- next
- end
- analyze after completion
- return to puzzle

Wrong moves must be identified as incorrect.

Hints must progressively reveal information using exactly the four
levels defined in `specs/PRODUCT.md` §10:

1. relevant piece
2. piece highlight
3. destination
4. move

Each level reveals strictly more information than the previous one. The
level at which each hint becomes available is configurable per puzzle.

For V1, hints beyond level 4 are not defined.

## Post-Solve Analysis

After the user marks a puzzle complete (solved correctly, failed, or
abandoned), the puzzle view shows an **engine analysis panel** built on
top of the **Live Analysis Board** primitive (Feature 006):

- Chessboard + move list showing the user's attempted sequence vs. the
  verified solution, side by side.
- Multiple PV lines for each divergence point (configurable, default 3).
- Per-move classification glyph (`??`, `?`, `?!`, `!`, `!!`) per
  ADR-023, drawn on the move list for both the user's attempt and the
  verified solution.
- Eval swing annotation for each divergence point: "Your move lost
  `X` percentage points; the engine preferred `Y`."
- A "Continue" button closes the analysis panel and returns to the
  puzzle queue.

### Outcomes

- A correctly solved puzzle shows the user's attempt with `best`
  classification on every move, no divergence annotations, and the
  verified solution overlaid as a single line.
- A failed puzzle shows the divergence point highlighted in red, with
  the engine's preferred move and the eval swing displayed.
- An abandoned puzzle (no attempt) shows the verified solution as the
  principal variation with no classification glyphs.

### Persistence

The analysis view is **read-only** over the puzzle's already-stored
analysis metadata (Feature 008 `MoveAnalysis[]`) and the cached engine
response (Feature 005 / ADR-018). No new analysis is run when the user
opens the post-solve panel.

## Acceptance Criteria

A user can complete, retry and analyze a puzzle without losing puzzle state.

Each hint level renders the information defined in `specs/PRODUCT.md`
§10 and no additional information.

For the Post-Solve Analysis:

- A user who solves a puzzle correctly sees an analysis view with
  `best` for every move in their solution.
- A user who fails a puzzle sees the divergence point highlighted
  with the engine's preferred move and the eval swing.
- An abandoned puzzle (no attempt) shows the verified solution as
  the principal variation.
- The "Continue" button closes the panel and returns to the puzzle
  queue without losing puzzle state.