# Feature 010 — Puzzle Training

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

## Acceptance Criteria

A user can complete, retry and analyze a puzzle without losing puzzle state.

Each hint level renders the information defined in `specs/PRODUCT.md`
§10 and no additional information.
