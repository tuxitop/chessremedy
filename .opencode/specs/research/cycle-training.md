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
user's own mistakes) are gathered into a fixed training block and
practised in repeated cycles**, with per-cycle measurement of:

- first-try accuracy and solve rate
- solving time (aggregate, average, optional median)
- hints used
- retries
- completion

Cycle configuration (block size, ordering, retry-failed behavior, hint
availability, optional targets) is a product decision, not a fixed
protocol constant (see `specs/domain/tactical-training.md`). The app never
creates a block on its own; the user commits with one click.

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
- Training is organized as explicit one-click Woodpecker blocks (a fixed
  snapshot of the derived pool) and Training Cycles; attempts are the atomic
  records. Quick train covers the pool ad hoc.
- Statistics/dashboard expose per-cycle and cross-cycle metrics
  (Feature 014/015).
- No scheduler library in `package.json` for V1.

## Woodpecker evidence digest (owner review, 2026)

A focused re-read of the Woodpecker material (Smith & Tikkanen, *The
Woodpecker Method*) to align ChessRemedy's training model. These are
coaching/practice observations, not controlled-study findings, and carry
the same "no comparative claim" caveat as Limitations above.

- **Set size.** The book's core set is **1128** exercises, split into
  **Easy / Intermediate / Advanced** groups; roughly **984** are
  recommended for most solvers. For a personal, mistake-derived pool,
  practical sets are far smaller — around **200–400** puzzles; below about
  **100**, later cycles risk memorising diagrams rather than training
  recognition.
- **Cycle ladder.** The recommended progression compresses each pass:
  **4 weeks → 2 weeks → 1 week → 4 days → 2 days → 1 day**, about
  **6–7 cycles** in total, roughly **halving total solving time** each
  step, with at least a **1-day break** between cycles.
- **Order.** Exercises are solved in a **fixed, difficulty-ascending
  order**; the set does not change between passes.
- **No 100% gate, no retirement.** The method targets a near-perfect,
  timed pass by repetition but has **no hard 100%-accuracy gate** and
  **does not retire** solved puzzles from the set — the same fixed set is
  re-solved.
- **First-cycle performance.** A first pass typically lands around
  **60–75%** accuracy, improving over the ladder.

### What ChessRemedy encodes

ChessRemedy adapts the method as follows (Feature 013, ADR-031):

- **No auto-creation.** The app never forms a set or block on its own; the
  user commits with the one-click **Create Woodpecker block** action.
- **Explicit, fixed block.** A block is a fixed snapshot of the derived
  **pool** (unmastered puzzles not in the open block), selected easy→hard in
  difficulty-ascending order (ties by `sourcePly` then `puzzleId`).
  Membership is frozen at creation and never re-derived per cycle; the order
  is never shuffled.
- **Practical size.** Default **200** (100/200/400 behind "Advanced"),
  guidance **200–400**; if the pool is smaller than the requested size, the
  block takes all of it.
- **One open block at a time.** Finishing or abandoning a block closes it and
  returns its still-unmastered members to the pool; the next block is formed
  from the remaining pool plus new puzzles.
- **Pool + Quick train.** The pool is derived and not stored; **Quick train**
  is an ad-hoc, non-stored session over the pool so a new user can practise
  immediately without committing a block.
- **No 100% gate.** `targetAccuracy` is optional and informational; success
  is framed as speed and automaticity.
- **Time goal.** Each cycle tracks its total solving time and shows the delta
  vs the previous cycle, with a "beat half the previous cycle's time" target
  and an optional ~6-cycle plan.
- **Spacing.** A same-day cycle restart (less than ~1 day since the previous
  cycle of the same block) shows a non-blocking ≥1-day spacing nudge.
- **Guidance, not gates.** The 60–75% first-cycle band and the ~6-cycle plan
  are surfaced as guidance only.
- **Mastery is informational.** A puzzle is mastered after a legitimate
  first-try solve in 3 distinct cycles; mastery retires nothing and mutates
  no row. A mastered puzzle is outside the pool by definition and so is not
  selected into a future block, but it stays in any existing block.

The former "auto-generated sets", the random subset, per-cycle membership
refresh, the 100% goal and automatic retirement are **removed**; they were
deliberate deviations that the owner has since replaced with the explicit
block model above.

## Open questions

1. How should V1 tune the initial block defaults (size, retry-failed
   behavior, guidance thresholds) as real usage data arrives?
2. When (if ever) should an individual scheduler be layered on, and how
   should its schedule derive from V1 attempt history?
3. Do hinted/retried solves carry the same training value as clean
   solves, and should they weight accuracy differently?
4. Should a closed block's history influence the next block (e.g. avoid
   recently mastered material beyond the derived-pool rule)?
