# Puzzle Generation Research

## Question

How can ChessRemedy convert a user's mistake in an analyzed game into
a high-quality, engine-verified training puzzle that:

- represents a meaningful tactical objective (not just "play the
  engine's first move"),
- supports multi-move tactical sequences,
- tolerates alternative solutions and opponent defences,
- has a deterministic, well-calibrated difficulty estimate,
- is reproducible and traceable back to the source game.

## Sources

1. Lichess puzzle database documentation
   (<https://lichess.org/page/puzzle-database>) — schema, ratings,
   themes.
2. Lichess `lila` source — `lila/modules/puzzle/src/main/Puzzle.scala`
   and `PuzzleGenerator.scala`, including the `gameId`/`ply` provenance
   fields.
3. Tomasz Michniewski, "Building a Chess Puzzle Database",
   ChessBase 2018.
4. `specs/research/tactical-detection.md` (the upstream pipeline).
5. `specs/research/move-accuracy.md` and `move-classification.md`.
6. `specs/research/browser-stockfish.md` (UCI profiles available).
7. ADR-005, ADR-006, ADR-012, ADR-019, ADR-020, ADR-026 (downstream
   constraints).

## Findings

### 1. Anatomy of a ChessRemedy puzzle

The puzzle model (`specs/domain/puzzle-model.md`, ADR-006) requires:

- `startingFEN` — the position *before* the user's mistake.
- `sideToMove` — usually the opponent of the player who made the
  mistake; sometimes the player themselves if the player is being
  asked to defend.
- `solutionTree` — the set of accepted first moves and continuations.
- `opponentResponses` — the moves the opponent is expected to play
  at each branch (best defence from the engine's analysis).
- `tacticalObjective` — one of the canonical outcomes
  (`specs/PRODUCT.md` §8).
- `difficulty` — a deterministic numeric rating.
- `verificationMetadata` — engine name/version/build, depth, profile,
  verification timestamp.

### 2. Sources of candidate puzzles

Three sources are eligible in V1 (ADR-006):

1. **Blunders** where the user dropped significant material or
   forced mate against themselves. The best line is the engine's
   recovery (if any).
2. **Missed tactical opportunities** detected by Feature 010. The
   best line is the tactic the user missed.
3. **Mistakes with a tactical consequence.** A move that is a
   "mistake" classification but whose best response is a tactic.

A puzzle candidate is rejected if:

- The engine's best move is `null` (terminal position).
- The best move does not produce a tactical objective from
  `specs/PRODUCT.md` §8.
- The solution requires more than 8 plies (V1 cap; puzzles beyond
  this are too long for training and become proof tasks).
- The puzzle appears elsewhere in the database already (deduplicated
  by FEN; see §7).

### 3. Multi-move solutions

The puzzle generator must not stop at the engine's first move
(ADR-006). The continuation is determined by re-analysing the position
after each engine move at the same depth used by Feature 005's
`tactical` or `deep` profile (ADR-012).

For each candidate the generator:

1. Identifies the first move `m1` (the engine's top move from the
   starting position).
2. Plays `m1` on a `chess.js` board and obtains the engine's
   response to it (`r1`).
3. If `r1` is unique and forced (only one candidate in MultiPV with
   a positive margin), record it as part of the solution tree.
4. If `r1` is not forced, record all reasonable opponent moves as
   branches of the solution tree.
5. Recurse, stopping when either:
   - the tactical objective is reached,
   - the maximum depth (8 plies) is exceeded,
   - or the position is non-tactical (`evalCp` saturated and stable).

### 4. Alternative solutions

A V1 puzzle must accept any move that also achieves the same
tactical objective (`specs/features/010-puzzle-generation.md`).

Concretely:

- After identifying `m1` and `r1`, the generator queries the engine
  with MultiPV = 5 at the puzzle position.
- Any candidate move whose continuation reaches the same tactical
  objective (same final material delta, or same mate, or same
  decisive advantage) within the depth limit is added to the
  solution tree as an alternative first move.
- The first move is the engine's top choice; alternatives are stored
  with their own continuations.

This is the pattern used by Lichess' puzzle generator (it accepts
multiple solutions when the engine finds them). For V1 the
implementation only requires MultiPV = 5 from Feature 005's
`tactical` profile (ADR-012); a separate profile is not needed.

### 5. Opponent responses

When the puzzle is "the user must find a winning combination", the
opponent (the puzzle's "side not to move") is allowed to play the
**best defensive move** only. Other moves are accepted as trivially
continuing the win, but the puzzle tracks the best defence as the
canonical opponent line.

This is computed by asking Stockfish to evaluate the position after
the user's move; the top engine move is the opponent's expected
reply. Branching on multiple opponent defences is not done in V1
(it is the next-biggest source of false negatives; see `tactical-
detection.md`).

### 6. Verification

Every accepted candidate must be re-verified by Stockfish before it
becomes a Puzzle (ADR-006, `specs/domain/tactics.md`).

The verification step:

1. Loads the starting FEN in `chess.js`.
2. Replays the recorded solution sequence.
3. Runs the engine from the final position with the `deep` profile
   (depth 30, MultiPV 3, 256 MB hash, WDL on — ADR-012) to confirm
   the tactical objective is still achieved.
4. Records `verificationMetadata` on the puzzle:
   `engineName`, `engineVersion`, `engineBuild`, `analysisVersion`,
   `verificationTimestamp`, `verificationDepth`, `verificationHash`.

If the verification run disagrees with the recorded solution (for
example because of a different engine version), the puzzle is rejected.
The puzzle is also rejected if the WDL at the end of the recorded
solution does not satisfy the tactical objective.

### 7. Deduplication

A FEN-keyed `puzzleCandidates` table is the primary deduplication
mechanism (ADR-018's same idea but applied to candidate *positions*,
not to engine outputs).

- The primary key of a candidate is the FEN at the starting position.
- If a candidate already exists for a FEN, the generator compares the
  existing solution with the new candidate. If the solutions match
  (same first move and same tactical objective), the new candidate is
  discarded. If the new candidate has a longer or different
  solution, the existing record is updated only when the new
  solution is strictly stronger (e.g. finds a deeper mate).

For V1 the dedup is exact-FEN. Transpositions (different move orders
reaching the same logical position) are not deduplicated; this is a
documented limitation.

### 8. Difficulty formula

The puzzle difficulty model must be:

- separate from engine evaluation,
- deterministic,
- a single number that can be aggregated, bucketed, and shown
  alongside the puzzle.

Five measurable properties drive the difficulty score
(`specs/features/010-puzzle-generation.md` §Difficulty):

| Property            | Symbol              | Range         | Higher means harder when… |
|---------------------|---------------------|---------------|---------------------------|
| Solution length     | `L` (plies)         | 1..8          | longer                    |
| Candidate-move count| `C` (MultiPV count) | 1..N          | more                      |
| Tactical forcingness| `F` (forced-plies %) | 0..100       | higher                    |
| Evaluation swing    | `E` (cp or wp loss) | 0..1000       | higher                    |
| Material involved   | `M` (pieces in tactic)| 0..32        | more involved pieces      |

The formula (V1) is a weighted sum, normalized to a 0..100 scale
where 0 = trivial and 100 = grandmaster-level:

```text
difficulty = clamp(0, 100, round(
    10 * min(L, 6)
  +  8 * min(C, 6)
  + 35 * (F / 100)
  + 12 * min(E, 400) / 400
  + 10 * min(M, 12) / 12
  +  5 * depthBonus))
```

where `depthBonus = 5` if the engine's depth was ≥ 26 (verified as
non-trivial), `0` otherwise.

The weights are derived from the relative importance observed in
the Lichess puzzle database (tactical forcingness is the strongest
single predictor of puzzle rating), and rounded so that each term
contributes at most the weight shown. The weights may be tuned once
V1 has a corpus of analysed games.

Bucketing for the UI:

| Bucket       | Range  | Typical example                |
|--------------|--------|--------------------------------|
| Trivial      | 0–14   | Mate in 1 with one forcing line |
| Easy         | 15–34  | One-move tactic, one alternative |
| Medium       | 35–59  | Two-move combination, multiple defences |
| Hard         | 60–79  | Multi-move, requiring calculation |
| Expert       | 80–100 | Long forcing line, multiple candidates |

### 9. Provenance and traceability

Every puzzle must preserve:

- `sourceGameId` (FK to the `games` table),
- `sourcePly` (the ply at which the source mistake was made),
- `sourceMovePlayed` (the move the user actually played, even when
  the puzzle's "side to move" is the opponent),
- `puzzleGeneratorVersion` (incremented on each change to the
  generator's algorithm or thresholds),
- `classificationVersion` at the time of generation (so the puzzle
  can be linked back to a specific classifier output).

This provenance is the "user can eventually understand what they
played, what they should have played, and why it mattered" guarantee
from `specs/PRODUCT.md` §9.

### 10. Determinism

Given the same source game and the same engine version, the
generator must produce the same set of puzzles. The generator is a
pure function of:

- the `MoveAnalysis[]` for the game,
- the engine name / version / build,
- the verification engine name / version / build,
- the classifier version,
- the puzzle-generator version itself.

All of these are versioned and persisted on the puzzle record. There
is no clock, no PRNG, and no global state in the generator.

### 11. Pipeline summary

```
        ┌────────────────────────┐
        │  Analyzed move (008)   │
        │  classified as blunder │
        │  or missed tactic      │
        └───────────┬────────────┘
                    │
                    ▼
        ┌────────────────────────┐
        │  Candidate generator   │   ← Feature 011 step 1
        │  (per source position) │
        └───────────┬────────────┘
                    │
                    ▼
        ┌────────────────────────┐
        │  MultiPV tactical run  │   ← Feature 005 tactical profile
        │  (depth 22, MultiPV 5) │
        └───────────┬────────────┘
                    │
                    ▼
        ┌────────────────────────┐
        │  Multi-move extension  │   ← Feature 011 step 2
        │  + alternative sols    │
        └───────────┬────────────┘
                    │
                    ▼
        ┌────────────────────────┐
        │  Deduplication         │   ← ADR-026
        │  (FEN-keyed)           │
        └───────────┬────────────┘
                    │
                    ▼
        ┌────────────────────────┐
        │  Deep verification     │   ← ADR-012 deep profile
        │  (depth 30, MultiPV 3) │
        └───────────┬────────────┘
                    │
                    ▼
        ┌────────────────────────┐
        │  Puzzle (persisted)    │
        │  with difficulty +     │
        │  provenance            │
        └────────────────────────┘
```

## Limitations

- Exact-FEN deduplication misses transposed positions. Lichess has
  the same limitation; addressing it requires a position-symmetry
  library and is out of scope for V1.
- Difficulty weights are not fit from a labelled corpus. They are
  derived from the qualitative ranking used by Lichess and other
  puzzle sources, and may need re-tuning once V1 has data.
- Branching opponent defences are not implemented in V1 (the puzzle
  generator picks the single best defence and accepts that the user
  may diverge).
- The maximum solution length cap (8 plies) is a soft cap; tactics
  longer than 8 plies are rare in human play and tend to be
  proof-style tasks that do not train tactical recognition.

## Recommendation

Implement the V1 puzzle generator as described above. Persist the
difficulty score and the provenance fields on every puzzle. See
ADR-025 (Puzzle Difficulty Formula) and ADR-026 (Tactical Verification
Pipeline).

## Sources

- `specs/PRODUCT.md` §8, §9
- `specs/ARCHITECTURE.md` §6 (Analysis Pipeline)
- `specs/domain/puzzle-model.md`
- `specs/domain/tactics.md`
- `specs/research/tactical-detection.md`
- `specs/research/move-classification.md`
- `specs/research/browser-stockfish.md`
- ADR-005, ADR-006, ADR-012, ADR-018, ADR-019, ADR-020
