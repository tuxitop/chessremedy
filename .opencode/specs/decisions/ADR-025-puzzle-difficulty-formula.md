# ADR-025: Puzzle Difficulty Formula

## Status

Accepted

## Decision

V1 assigns every persisted Puzzle a deterministic `difficulty` score
in `[0, 100]`, computed from five measurable properties of the
verified puzzle. The score is a weighted sum that maps cleanly to
five user-visible buckets:

| Bucket  | Range   | Typical example                              |
|---------|---------|----------------------------------------------|
| Trivial | 0–14    | Mate in 1 with one forcing line              |
| Easy    | 15–34   | One-move tactic, one alternative solution    |
| Medium  | 35–59   | Two-move combination, multiple defences      |
| Hard    | 60–79   | Multi-move tactic requiring calculation      |
| Expert  | 80–100  | Long forcing line, many candidate moves      |

### Inputs

| Symbol | Property             | Source                                                   |
|--------|----------------------|----------------------------------------------------------|
| `L`    | Solution length in plies | Multi-move extension (Feature 011)                  |
| `C`    | Number of accepted candidate first moves | MultiPV result            |
| `F`    | Tactical forcingness (%) | `(checks + captures) / (2 * L) * 100`                |
| `E`    | Evaluation swing (centipawns) | `|evalCpAfterBestLine − evalCpStart|`          |
| `M`    | Material involved (piece-value units, queen = 9) | From the position before and after the tactic |
| `depth`| Engine verification depth | ADR-012 `deep` profile, default 30            |

### Formula

```text
difficulty = clamp(0, 100, round(
    10 * min(L, 6)
  +  8 * min(C, 6)
  + 35 * (F / 100)
  + 12 * min(E, 400) / 400
  + 10 * min(M, 12) / 12
  +  depthBonus))

depthBonus = 5 if depth >= 26 else 0
```

The `clamp` keeps the value in `[0, 100]`. Each term contributes at
most its weight (so the maximum possible score before clamping is
`10*6 + 8*6 + 35*1 + 12*1 + 10*1 + 5 = 156`, which clamps to 100).

The bucket boundaries match the typical Lichess puzzle-rating ranges
(800–1000 Trivial, 1000–1400 Easy, 1400–1800 Medium, 1800–2200 Hard,
2200+ Expert) after a piecewise-linear mapping that the dashboard
will compute; the underlying score stored on the puzzle is the
`[0, 100]` value above, not a Glicko rating.

## Reasons

- A single scalar difficulty is the only representation that
  supports aggregation, bucketing, sorting and "show me harder
  puzzles" filtering without per-puzzle custom UI logic.
- All five inputs are available at puzzle-generation time
  (`specs/research/puzzle-generation.md` §8). No human labelling
  is required.
- The weights are derived from the Lichess puzzle-rating
  correlations: forcingness is the strongest single predictor of
  puzzle difficulty, followed by evaluation swing and solution
  length. The chosen weights mirror that ordering.
- The bucket boundaries are chosen so that a uniformly random
  subset of V1 puzzles falls roughly into the Medium bucket,
  matching Lichess' published distribution.

## Consequences

- Difficulty is a *function* of the puzzle's verification output,
  not of the user's eventual success rate. A puzzle is not
  re-rated after the user solves it; personal performance is
  recorded in puzzle attempts and cycle aggregates (ADR-031,
  `specs/domain/tactical-training.md`), never on the puzzle.
- The score is sensitive to engine depth at the verification stage.
  Bumping the verification depth from 30 to 35 will re-rank some
  puzzles. The `puzzleGeneratorVersion` field on each puzzle
  identifies which version of the formula produced the score.
- The formula constants are empirical. They may need re-tuning
  once V1 has a corpus of puzzles and player solves. Tuning
  requires a new ADR; the previous `puzzleGeneratorVersion`'s
  stored scores are not retroactively re-mapped.
- Tactical-detection (Feature 010) rejects candidates with a
  difficulty estimate below 15 (the "Easy" bucket minimum). This
  is the quality filter that prevents the puzzle database from
  being flooded with trivial one-move tactics.

## Sources

- `specs/PRODUCT.md` §8, §9
- `specs/ARCHITECTURE.md` §6
- `specs/domain/puzzle-model.md`
- `specs/features/011-puzzle-generation.md`
- `specs/research/puzzle-generation.md`
- ADR-005, ADR-006, ADR-012, ADR-026
