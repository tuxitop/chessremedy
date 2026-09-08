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

## Immutable natural key

A puzzle is identified by `[sourceGameId, sourcePly]` — at most one puzzle
per game and ply. The row is immutable once written: re-analysis never
replaces or deletes an existing puzzle (it only adds keys that are absent),
so puzzles and any later practice/attempts stay stable across engine or
detection upgrades. Cross-game FEN merging/dedup is out of scope in V1.

## Puzzle generation pass

Puzzles are produced by an engine-free generation pass that promotes the
verified tactical candidates (Feature 010) of an analysis. Per analysis the
pass state holder on the analysis summary moves through
`absent → queued → inProgress → completed | failed`:

- `absent` — detection not complete, or generation never run for this
  analysis. The Library/view shows a note, never a zero.
- `queued` — pass interrupted/aborted; resumable (resume skips rows already
  persisted).
- `inProgress` — a pass is running; progress `done/total` counts the verified
  candidates already promoted.
- `completed` — the pass finished; `0` promoted candidates is a real zero and
  is shown as `Puzzles 0`/`No puzzles`.
- `failed` — a write error occurred; retry resumes from the persisted rows.

A completed detection result whose stored `detectionVersion` differs from the
current constant is treated as outdated: puzzle state/counts are suppressed
until a fresh scan re-derives candidates. Generation never does engine work,
never runs on the UI thread, and is resumable on demand.

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
