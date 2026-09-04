# Puzzle Model

A Puzzle contains:

- id
- source game
- source ply
- starting FEN
- user's original move
- expected solution
- solution tree/sequence
- tactical objective
- tactical motifs *(reserved for future scope; must not be populated in V1)*
- difficulty metadata
- engine verification metadata
- generation version

A solution may contain multiple moves.

The puzzle is complete when its tactical objective is resolved.

The puzzle should preserve enough provenance to explain:

- what the user played
- what opportunity existed
- what the solution was
- why the sequence mattered

## No scheduling state

A Puzzle is an immutable definition and carries **no scheduling or
training state** — no due date, no review interval, no stability and no
per-user difficulty (ADR-031). A puzzle may belong to zero, one or many
tactical training sets; membership is tracked by the set, and practice
history is recorded as puzzle attempts, both defined in
`specs/domain/tactical-training.md`.

## Ownership & deletion

A Puzzle is owned by its source game. Deleting the source game deletes
its puzzle candidates and puzzles (and transitively their attempts and
training-set membership) per the ownership rule in `ARCHITECTURE.md` §7
and `domain/game-library.md`. No orphaned puzzle may remain after its
source game is deleted.
