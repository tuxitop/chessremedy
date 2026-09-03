# Feature 012 — Puzzle Training

## Goal

Allow the user to solve personalized puzzles within an active tactical
training cycle.

Puzzles are trained as part of a fixed **training set** and an active
**training cycle** (Feature 013 / ADR-031). This feature is the solving
experience: presenting a puzzle, handling the user's moves, hints,
retries and post-solve analysis, and recording each attempt. The
set/cycle lifecycle, ordering and cycle results are owned by Feature
013.

## Training context

- The user enters a training cycle for a selected set; the next puzzle
  in the cycle is presented.
- Solving, retrying, skipping and abandoning follow the rules in
  `specs/domain/tactical-training.md`.
- Each puzzle interaction produces a `PuzzleAttempt` (result, solve
  time, attempts, hints used, retries) recorded by Feature 013.
- After completing or exiting a puzzle, the view returns to the current
  cycle (next puzzle or cycle results), not to a per-puzzle scheduler
  (ADR-031).

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
- return to puzzle / current cycle

Wrong moves must be identified as incorrect.

Hints follow the four progressive levels defined in `specs/PRODUCT.md` §10 (the authoritative definition); this feature implements those levels and the configured level at which each hint becomes available. For V1, hints beyond level 4 are not defined.

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
  current training cycle (next puzzle or cycle results).

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
- The "Continue" button closes the panel and returns to the current
  training cycle without losing puzzle state.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` (post-solve reuse of Feature
  006); `decisions/ADR-031`, `decisions/ADR-023`, `decisions/ADR-018`;
  optional `history/ADR-007/011/021/022` (history only)
- Domain: `domain/tactical-training.md`, `domain/puzzle-model.md`
- Research: `research/cycle-training.md`

Feature dependencies: Features 006, 008, 011, 013; PRODUCT §10 (hint
levels, authoritative).
