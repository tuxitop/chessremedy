# ADR-035: Individual Review Scheduling (post-V1)

## Status

Accepted

## Context

V1 tactical training is cycle-based (ADR-031): fixed puzzle sets are solved
in repeated cycles, there is **no per-puzzle scheduler and no FSRS
dependency in V1**, and the immutable puzzle/attempt model is kept free of
scheduling state so a future individual scheduler can be layered on
without migration. ADR-031, `domain/tactical-training.md` §"Future
scheduling" and `ARCHITECTURE.md` §12 all reserve that branch.

Feature 020 realizes it: a daily **review** mode that resurfaces individual
puzzles when they are about to be forgotten, beside cycle training. This
ADR decides the scheduler library and the storage/semantics contract for
that post-V1 strategy.

## Decision

ChessRemedy adds an **individual review-scheduling strategy** alongside
cycle training, gated behind a pure domain `Scheduler` interface.

1. **Scheduler abstraction.** `Scheduler` is a pure, deterministic domain
   interface (`initialState`/`preview`/`next`/`retrievability`) over a
   serializable `ScheduleState` (epoch-millis timestamps, no `Date`
   instances). A single adapter imports the library and is the only module
   that does; the algorithm is swappable without changing the projection
   schema, grade mapping or review UI.
2. **Library.** Adopt **`ts-fsrs`** (MIT, zero runtime dependencies,
   browser-compatible, storage-agnostic) as recommended by
   `research/fsrs-implementation.md`. The exact version lives in
   `package.json`/the lockfile per the Dependency policy; **no version pin
   in this ADR**.
3. **Derived projection.** Schedule state is stored in a **derived,
   rebuildable** `puzzleSchedules` table (additive Dexie schema **v13**),
   keyed by `puzzleId`, indexed by `dueAt`, and versioned by
   `scheduleVersion`/`schedulerParamsVersion`. It is **never
   authoritative, never synced** (ADR-016 envelope exclusion) and may be
   dropped and rebuilt from the immutable `puzzleAttempts` log — the
   ADR-018 cache pattern. It is cascade-deleted with its puzzle.
4. **No new event data.** Review presentations write ordinary immutable
   `puzzleAttempts` rows; the schedule is `f(attempt history)`.
5. **Strategy separation.** Review sessions run under a reserved
   `REVIEW_SET_ID` sentinel (the Quick-train pattern), are excluded from
   mastery and cycle/set statistics, and do not change cycle training.
6. **V1 scope.** ADR-031's "no scheduler in V1" prohibition is **V1-scoped
   and remains in force for V1**. This ADR governs the post-V1 strategy
   only; the cycle-training decision in ADR-031 is unchanged.

## Rationale

- FSRS is a proven, actively maintained spaced-repetition scheduler;
  `ts-fsrs` is MIT, zero-dependency, browser-compatible and
  storage-agnostic, matching the license posture (ADR-027) and Dependency
  policy. The alternatives are worse (see below).
- Immutable attempts already exist, so deriving schedule state keeps
  `Puzzle` scheduling-free (ADR-031) and needs **no data migration**.
- The derived, unsynced cache mirrors ADR-018 and preserves local-first /
  offline behaviour (ADR-001): on a new device the schedule rebuilds from
  synced attempts.
- Reusing the cycle-session host and the Quick-train sentinel keeps
  mastery, cycle metrics and attempt semantics untouched.

## Alternatives considered

- **Self-implemented SM-2** — no dependency, but a correct implementation
  needs learning steps, lapse/relearning handling, interval fuzz and
  same-day review rules; it would be inferior and maintenance-heavy.
  Rejected.
- **`fsrs-browser`** (WASM, BSD-3-Clause) — ~378 kB WASM is unjustified
  for scheduler-only use. Rejected.
- **`@squeakyrobot/fsrs`** — too new and unvalidated (v1.0.0, minimal
  adoption, missing persistence helpers). Rejected.
- **Cycle training only** — does not meet the product goal of an
  individual review queue. Rejected.

## Consequences

- A new runtime dependency (`ts-fsrs`) enters `package.json`; its version
  is managed by the Dependency policy, not this ADR.
- A new additive schema **v13** (`puzzleSchedules`), derived and unsynced;
  `PERSISTENCE_SCHEMA_VERSION` becomes 13.
- A new domain specification `domain/review-scheduling.md` captures the
  scheduler/grade/projection/due-queue rules.
- Review activity is excluded from mastery and Feature-014 statistics for
  now; a future feature may opt it in explicitly.
- Swapping the scheduler algorithm later is an adapter change with a
  version bump, not a data migration.

## Sources

- `specs/ARCHITECTURE.md` §3, §7, §9, §12
- `specs/features/020-individual-review-scheduling.md`
- `specs/domain/tactical-training.md` (§"Future scheduling")
- `specs/domain/puzzle-model.md`
- `specs/decisions/ADR-018` (derived, unsynced cache)
- `specs/decisions/ADR-027` (license), `ADR-031` (cycle training, V1)
- `specs/research/fsrs-implementation.md`
