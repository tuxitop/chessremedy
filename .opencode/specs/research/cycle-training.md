# Cycle-Based Tactical Training (Woodpecker Method)

## Question

Should ChessRemedy V1 schedule personalized puzzle review with an
individual spaced-repetition algorithm (FSRS), or train fixed puzzle
sets in repeated cycles (Woodpecker-style)? What does the evidence
support, and how should ChessRemedy adapt it?

## Sources

- Axel Smith & Hans Tikkanen, *The Woodpecker Method* (Quality Chess,
  2019) — repeated solving of a fixed set of tactical exercises until a
  near-perfect, timed pass is achieved.
- Michael de la Maza, *Rapid Chess Improvement* (Everyman, 2002) — the
  "seven circles" idea of repeatedly solving a fixed book of positions.
- General spaced-repetition literature, including FSRS documentation
  (open-spaced-repetition) — flashcard-style scheduling of individual
  items based on recall performance.
- ChessRemedy internal: ADR-031 (Cycle-Based Tactical Training),
  `specs/domain/tactical-training.md`, previous research
  `specs/research/fsrs-implementation.md`.

## Findings

### Historical description of the Woodpecker method

The Woodpecker method (as described in Smith & Tikkanen's book) is a
training protocol built around a **fixed set** of tactical puzzles:

- The learner solves the same set repeatedly.
- A set is often large (hundreds of puzzles), and a pass is timed.
- Progress is measured as improving accuracy and speed over successive
  passes of the same set.
- The goal is automation of tactical pattern recognition: seeing the
  pattern faster and more reliably, not just remembering one puzzle.

de la Maza's earlier "seven circles" approach is the same underlying
idea: repeated passes over a bounded set.

### ChessRemedy's adaptation

ChessRemedy does not reproduce any specific published protocol. It
adopts the general principle: **personalized puzzles (derived from the
user's own mistakes) are grouped into fixed training sets and practised
in repeated cycles**, with per-cycle measurement of:

- first-try accuracy and solve rate
- solving time (aggregate, average, optional median)
- hints used
- retries
- completion

Cycle configuration (set size, ordering, retry-failed behavior, hint
availability, optional targets) is a product decision, not a fixed
protocol constant (see `specs/domain/tactical-training.md`).

### Claims supported by evidence

- Repeated, spaced re-exposure to a problem strengthens recognition of
  that problem's pattern. This is consistent with both the Woodpecker
  tradition and spaced-repetition research.
- Measuring a fixed set across repeated passes gives a directly
  comparable accuracy/time signal.

### Assumptions / product decisions

- That a fixed-set cycling model is a good V1 fit for a library of
  personalized, mistake-derived puzzles. This is a product decision,
  not a proven claim.
- That cycle-level analytics (accuracy/time by cycle) are the metrics
  the product should surface in V1.
- That an individual scheduler such as FSRS is unnecessary for V1 and
  can be layered on later without discarding puzzle or attempt data.

## Limitations

- **No comparative claim.** The available material does not establish
  that Woodpecker-style cycle training is *superior* to FSRS (or any
  individual scheduler) for tactical puzzle training. ChessRemedy's
  choice of cycle training for V1 is a product decision based on fit and
  simplicity, not a claim of proven superiority.
- Much of the Woodpecker literature is anecdotal/coaching practice
  rather than controlled studies. ChessRemedy should not assert
  scientific backing for specific protocols, cycle counts or timings.
- Individual differences (a user may recall individual puzzles rather
  than generalize) are not addressed by fixed-set repetition alone;
  V1 does not attempt to model this.

## Recommendation

Use fixed-set, cycle-based tactical training for V1 (ADR-031): no FSRS
dependency, no per-puzzle scheduling state, configurable cycle
behavior, and cycle-level analytics. Keep the puzzle model scheduling-
free so a future individual scheduler can be introduced without data
migration.

## Impact on ChessRemedy

- Replaces the earlier FSRS-based scheduling decision (ADR-007/011/021/
  022 superseded).
- Training is organized as Tactical Training Sets and Training Cycles;
  attempts are the atomic records.
- Statistics/dashboard expose per-cycle and cross-cycle metrics
  (Feature 014/015).
- No scheduler library in `package.json` for V1.

## Open questions

1. How should V1 tune the initial cycle defaults (set size, ordering,
   retry-failed behavior) as real usage data arrives?
2. When (if ever) should an individual scheduler be layered on, and how
   should its schedule derive from V1 attempt history?
3. Do hinted/retried solves carry the same training value as clean
   solves, and should they weight accuracy differently?
