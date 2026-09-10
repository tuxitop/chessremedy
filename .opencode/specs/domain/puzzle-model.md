# Puzzle Model

A Puzzle contains:

- id
- source game
- source ply
- starting FEN
- user's original move
- expected solution
- solution tree/sequence
- origin/kind (`'tactical'` or `'blunder'`; absent on pre-version-2 rows =
  `'tactical'`)
- tactical objective *(tactical rows only; blunder rows instead present the
  fixed "Find the best move" objective)*
- tactical motifs *(reserved for future scope; must not be populated in V1)*
- difficulty metadata
- engine verification metadata *(tactical rows only)*
- generation version

A Puzzle has **two origins**:

1. **Tactical** — promoted from a Feature-010 verified candidate. The solution
   is the verified forcing line (possibly multiple moves) and the row carries
   the tactical objective, the ADR-025 difficulty estimate, the verification
   metadata and the accepted alternative first moves.
2. **Blunder ("correct-move")** — a user-side `MoveAnalysis` ply classified
   `'blunder'` (ADR-023) that Feature-010 did **not** verify. The solution is
   the single best move (`bestPv = [bestMove]`, "find the move you should have
   played"), the row has **no** tactical objective, verification metadata,
   candidate-solution length or accepted alternatives, and its difficulty is a
   deterministic, **provisional** estimate derived from the ply's stored eval
   swing (larger swing → easier puzzle). V1 does **not** re-rate puzzles from
   solver data: the row is immutable and carries no per-user difficulty
   (ADR-031), so solver-calibrated difficulty is out of V1 scope. A future
   feature could introduce a derived, non-authoritative rating store outside the
   immutable puzzle row. There is no engine work behind a blunder row.

A solution may contain multiple moves (tactical rows); a blunder row is a
one-move puzzle by construction.

The puzzle is complete when its tactical objective is resolved (tactical rows)
or the correct move is found (blunder rows).

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
detection upgrades. When a ply is **both** a verified tactical candidate and a
user blunder, the tactical row wins (the generation pass processes candidates
before blunder plies and writes add-only); no blunder row is created for that
ply. Cross-game FEN merging/dedup is out of scope in V1.

Rows are plain objects, so the version-2 additions (`origin`, optional
tactical-only fields) need **no persistence schema change** — the `puzzles`
schema/indexes are unchanged. Blunder rows store `candidateGenerationVersion`
as `null` (there is no Feature-010 candidate).

## Puzzle generation pass

Puzzles are produced by an engine-free generation pass that promotes the
verified tactical candidates (Feature 010) **and** the qualifying user-side
blunder plies of an analysis. Per analysis the pass state holder on the
analysis summary moves through
`absent → queued → inProgress → completed | failed`:

- `absent` — detection not complete, or generation never run for this
  analysis. The Library/view shows a note, never a zero.
- `queued` — pass interrupted/aborted; resumable (resume skips rows already
  persisted).
- `inProgress` — a pass is running; progress `done/total` counts the input
  items already settled (verified candidates plus qualifying blunder plies;
  a ply that is both settles twice — one row).
- `completed` — the pass finished; `0` promoted items is a real zero and
  is shown as `Puzzles 0`/`No puzzles`.
- `failed` — a write error occurred; retry resumes from the persisted rows.

A completed detection result whose stored `detectionVersion` differs from the
current constant is treated as outdated: puzzle state/counts are suppressed
until a fresh scan re-derives candidates. Generation never does engine work,
never runs on the UI thread, and is resumable on demand.

A completed **generation** result is final only for the `puzzleGeneratorVersion`
it ran under: it is *current* when `completed` and its stored version equals
the current `PUZZLE_GENERATOR_VERSION`. When the generator version advances, a
previously-completed pass is *outdated* — its rows remain immutable and
visible, and an engine-free **Regenerate** action re-runs the same add-only
assembly over the stored detection outputs (verified candidates + stored
user-side blunder plies of that analysis) to add the newly-available puzzle
kinds (notably one-move blunder correct-move rows). Regeneration never
overwrites or deletes rows; the completed summary then records the current
generator version. Regeneration is explicit only (never auto-backfilled by
reconcile/session start); the natural re-settle of a fresh detection pass over
an older completed pass is itself a regeneration.

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
