# Plan — W3: Missed-tactic exclusivity

Plan-only. No code, tests, or commits are produced by authoring this
document. Scope is fixed by the ADR-023 amendment and features
009/010/011/014; nothing here redesigns an unrelated area.

## 1. Objective

A ply that is a **current-version verified missed tactic**
(`missedTactic === true && detectionVersion === DETECTION_VERSION`, or
equivalently a `verified` candidate for the same
`[analysisId, sourcePly]` at the current `DETECTION_VERSION`) gets an
**effective classification state** `missedTactic`:

- a presentation/statistics state, **not** a sixth persisted
  `MoveClassification` and **not** a `classificationVersion` change;
- the raw ADR-023 label is retained as provenance but suppressed
  everywhere;
- Game Review renders **exactly one** annotation — the canonical
  missed-tactic marker (`MISSED_TACTIC_NAG` 9); the negative
  classification glyph/colour/board chip/square highlight are
  suppressed;
- excluded from inaccuracy/mistake/blunder (and best/good) counts,
  per-game rates/shares, `gamesWithBlunderShare`, `hasBlunders`, and
  phase error numerators;
- **kept** in move-exposure denominators (`userMoves`,
  `userMovesInPhase`, `detectedUserMovesInPhase`);
- ADR-024 accuracy is **unchanged** (the ply stays in the per-move
  accuracy and the `accuracyMoves` weight);
- Feature 011 yields **exactly one** puzzle: the verified candidate
  wins and the blunder-origin input excludes candidate-owned plies; a
  stale candidate falls back to raw classification + blunder origin.

Freshness is the Feature-010 gate: a stale marker
(`detectionVersion !== DETECTION_VERSION`) is suppressed and the ply
renders/counts as its raw ADR-023 classification.

## 2. Scope

In scope:

- A single pure domain derivation seam for the effective state.
- Classification-count consumers: per-analysis summary, Game Review
  summary, Feature-014 error aggregates + phase numerators,
  `hasBlunders` (via persisted summary counts).
- Game Review presentation: one annotation only.
- Puzzle-generation input exclusivity.
- Version bumps: `DETECTION_VERSION` 10 → 11, `STATISTICS_VERSION`
  next value; `CLASSIFICATION_VERSION` stays 2.
- Tests (domain, statistics, component, puzzle-generation, e2e) and
  stale-version fallbacks.

Out of scope (explicitly not changed):

- The ADR-023 classifier (`src/domain/chess/classification.ts`) and
  `CLASSIFICATION_VERSION`.
- ADR-024 accuracy math and `MOVE_ACCURACY_VERSION` (stays 2).
- `PUZZLE_GENERATOR_VERSION` (stays 2) — the persisted puzzle row set
  is unchanged; only the blunder input set is tightened.
- Candidate generation / Stage-2 guards (`CANDIDATE_GENERATION_VERSION`
  stays 2); the verified set is unchanged.
- Any new schema/table.
- W2 (verification depth) — no `DETECTION_VERSION` bump there.

## 3. Existing code to reuse (anchors)

- `src/domain/chess/analysis.ts:120-127` — `MoveAnalysis.classification`,
  `missedTactic`, `detectionVersion`.
- `src/domain/chess/classification.ts:18` — `CLASSIFICATION_VERSION = 2`
  (unchanged).
- `src/domain/tactics/types.ts:71` — `DETECTION_VERSION = 10` (bump).
- `src/domain/tactics/annotate.ts` — `annotateVerifiedMisses`,
  `clearMissedTacticAnnotations` (unchanged; the freshness wipe/rebuild
  already exists).
- `src/domain/analysis/classificationMeta.ts:81-101` — `MISSED_TACTIC_NAG`,
  `missedTacticMeta`, classification NAG mapping (single source).
- `src/domain/analysis/summary.ts:51-79` — `summarizeAnalysis` five-bucket
  counts + `userMissedTactics`/`userMoves`.
- `src/domain/analysis/summaryDerivation.ts:194-224` —
  `buildAnalysisSummary` (persisted per-analysis summary).
- `src/domain/statistics/phase.ts:63-119` — `summarizeByPhase`
  (`userMovesInPhase`/`detectedUserMovesInPhase` denominators and error
  numerators).
- `src/domain/statistics/gameMetrics.ts:84-139` — error counts/rates/
  medians/`gamesWithBlunderShare`, all read from
  `GameHistoryEntry.classificationCounts` (no change needed once the
  persisted summary excludes exclusive plies).
- `src/domain/statistics/types.ts:66` — `STATISTICS_VERSION = 1` (bump).
- `src/infrastructure/puzzles/puzzleGenerationService.ts:162-205,249-277`
  — verified list + `qualifyingUserBlunders` (candidate-first ordering).
- `src/pages/GameReviewPage.tsx:779-830` — `classificationByPly`,
  `missedTacticByPly`, `effectiveNagOverrides`; `:833-876`
  `activeClassification`/`boardBadges`/`emphasizedSquares`;
  `:1107-1119` missed-tactic label.
- `src/domain/gameLibrary/predicates.ts:47-56` — `hasBlunders` reads
  `classificationCounts.blunder` (no change needed once the summary
  excludes the ply).
- `src/infrastructure/db/analysis-result-query.ts:139-153` — Library row
  insights read the persisted summary (no change needed).
- `src/components/games/library/GameLibrary.tsx:1045-1057` — strip counts
  read `row.classificationCounts` (no change needed).

## 4. The derivation seam

Create one pure module so the rule is defined once and every consumer
imports it — no duplicated boolean logic:

`src/domain/analysis/effectiveClassification.ts`

```ts
export type EffectiveClassification = MoveClassification | 'missedTactic';

/** True only for a user ply that is a current-version verified miss. */
export function isExclusiveMissedTactic(
  record: MoveAnalysis,
  currentDetectionVersion: number,
): boolean;

/** `'missedTactic'` when exclusive, else the raw persisted classification. */
export function effectiveClassificationOf(
  record: MoveAnalysis,
  currentDetectionVersion: number,
): EffectiveClassification;
```

- Gating: `record.missedTactic === true &&
  record.detectionVersion === currentDetectionVersion`.
- Side guard: only the user's own ply is exclusive. The candidate rules
  emit user plies only (`domain/tactics.md` "Candidate generation
  scope"), and the annotation service only flags user plies, but the
  predicate must not silently exempt an opponent ply that carries a
  stray flag. `summarizeAnalysis` passes `userColor`; callers that do
  not have a color pass the record's side as the user (the annotate
  path guarantees user-only flags). Prefer an explicit
  `isExclusiveMissedTactic(record, currentDetectionVersion)` that checks
  the flag/version, and let each consumer apply it only on the user's
  side (as the count loops already separate user/opponent).
- `effectiveClassificationOf` returns the raw label for stale flags so
  the freshness fallback is automatic.
- Export both from `src/domain/analysis/index.ts` (barrel) and keep the
  module free of React/Dexie/Worker imports.

### Consumers to update

1. `src/domain/analysis/summary.ts` — `summarizeAnalysis`:
   - add an optional `currentDetectionVersion` parameter defaulting to
     `DETECTION_VERSION` (imported from `@/domain/tactics`);
   - in the user branch, when the record is exclusive: do **not**
     `addCount` to any of the five buckets, still `userMoves += 1`, still
     count `userMissedTactics`;
   - opponent branch unchanged (raw counts).
   - This is the single place the persisted summary is built from, so
     `buildAnalysisSummary` (`summaryDerivation.ts:199`) inherits the
     exclusion with no signature change. `accuracy`/`accuracyMoves`
     continue to come from `gameAccuracy`, which is untouched.
2. `src/domain/statistics/phase.ts` — `summarizeByPhase`:
   - add a `currentDetectionVersion: number` parameter (or import the
     constant; prefer an explicit parameter for deterministic fixtures);
   - still increment `userMovesInPhase` for every user move (denominator
     keeps the ply);
   - when the record is exclusive, skip the
     `inaccuracy`/`mistake`/`blunder` numerator increments and still
     count `missedTactics`; keep `detectedUserMovesInPhase` incrementing
     (denominator);
   - thread the current version from `compute.ts`
     `phaseSetForRecords` (`src/domain/statistics/compute.ts:431-448`),
     which already receives `currentDetectionAnalysisIds` and imports
     `DETECTION_VERSION`.
3. `src/pages/GameReviewPage.tsx` — presentation:
   - derive `exclusiveMissedByPly` (currently `missedTacticByPly`) with
     the same predicate;
   - in `classificationByPly` (`:779-794`), after merging stored + live +
     overlay classifications, **delete** every exclusive ply id so the
     live overlay cannot re-introduce a classification glyph for an
     exclusive ply;
   - `effectiveNagOverrides` (`:817-830`) then yields `[MISSED_TACTIC_NAG]`
     only (classification NAG absent) for exclusive plies;
   - `activeClassification`/`boardBadges`/`emphasizedSquares`
     (`:833-876`) become undefined/null for exclusive plies, suppressing
     the chip, colour and start/end-square highlight (the plain last-move
     highlight returns via `lastMove={emphasizedSquares ? null : lastMove}`);
   - the missed-tactic label (`:1107-1119`) stays as-is (already gated).
4. `src/infrastructure/puzzles/puzzleGenerationService.ts`:
   - build `candidateOwned: Set<"analysisId:sourcePly">` from the
     current-version `verified` list;
   - pass it to `qualifyingUserBlunders` and skip any record whose key is
     owned, so the blunder origin excludes candidate-owned plies;
   - the candidate-first loop and the stale-candidate filter
     (`:166-169`) are unchanged; a stale candidate is ignored, so its ply
     still falls through to the blunder origin.
5. No change needed in `gameMetrics.ts`, `predicates.ts`,
   `analysis-result-query.ts`, or `GameLibrary.tsx`: they read the
   persisted summary counts, which `buildAnalysisSummary` now derives
   under the rule. Verify by test, not by editing.

## 5. Version coordination (W2 / W3 / W5)

Current code: `DETECTION_VERSION = 10`, `CLASSIFICATION_VERSION = 2`,
`STATISTICS_VERSION = 1`, `PUZZLE_GENERATOR_VERSION = 2`,
`MOVE_ACCURACY_VERSION = 2`, `TIME_CONTROL_CATEGORY_VERSION = 1`.

| Constant | W3 action | Final after W3 + W5 |
| --- | --- | --- |
| `DETECTION_VERSION` | 10 → **11** | 11 (W2 adds no bump) |
| `CLASSIFICATION_VERSION` | unchanged | 2 |
| `STATISTICS_VERSION` | next value | **3** |
| `PUZZLE_GENERATOR_VERSION` | unchanged | 2 |
| `MOVE_ACCURACY_VERSION` | unchanged | 2 |
| `TIME_CONTROL_CATEGORY_VERSION` | untouched (W5) | 2 |

- **W2 (verification depth)** changes no candidate rule/guard/threshold
  and keeps depth out of the freshness gate, so it takes **no**
  `DETECTION_VERSION` bump. W3's 10 → 11 is the only detection bump in
  this batch.
- **W5 (platform time controls)** bumps `STATISTICS_VERSION` 1 → 2 for
  the category re-normalization (ADR-013). W3's exclusivity is a further
  aggregation-semantics change and takes the next value.
- **Ordering / expected final value.** The Feature-014 §12 text writes
  `STATISTICS_VERSION = 3` for exclusivity, assuming the ADR-013
  time-control bump has landed at 2. Because the repo is still at 1 and
  W5 is concurrent:
  - if W5 lands first: W3 sets `STATISTICS_VERSION` 2 → 3;
  - if W3 lands first: W3 sets 1 → 2, and W5 must then set 2 → 3 and keep
    both changes in the version provenance.
  - Either ordering converges on **`STATISTICS_VERSION = 3`** once both
    W2/W5 and W3 have landed. Record the exclusivity change in the
    version provenance/comment regardless of order.
- Do not bump `CLASSIFICATION_VERSION`, `MOVE_ACCURACY_VERSION` or
  `PUZZLE_GENERATOR_VERSION`.

## 6. Files to create or modify

Create:

- `src/domain/analysis/effectiveClassification.ts` (seam).
- `src/domain/analysis/effectiveClassification.test.ts`.
- `tests/e2e/missed-tactic-exclusivity.spec.ts` (single-X e2e; may
  instead extend `tests/e2e/game-analysis-review.spec.ts` — see §8).

Modify (production):

- `src/domain/tactics/types.ts` — `DETECTION_VERSION` 10 → 11 + version
  comment.
- `src/domain/analysis/summary.ts` — exclusivity in `summarizeAnalysis`.
- `src/domain/analysis/summaryDerivation.ts` — pass the current version
  through to `summarizeAnalysis` (or rely on the default; keep the
  default for the persisted build path).
- `src/domain/analysis/index.ts` — export the seam.
- `src/domain/statistics/phase.ts` — phase numerators exclude exclusive
  plies; denominators keep them.
- `src/domain/statistics/compute.ts` — thread the current detection
  version into `summarizeByPhase`.
- `src/domain/statistics/types.ts` — `STATISTICS_VERSION` next value
  (coordinate with W5, §5).
- `src/infrastructure/puzzles/puzzleGenerationService.ts` — candidate-owned
  exclusion in `qualifyingUserBlunders`.
- `src/pages/GameReviewPage.tsx` — exclusive plies in
  `classificationByPly`; single-annotation overrides.
- `tests/e2e/013-woodpecker-block.spec.ts` — fixture constant 10 → 11.
- `tests/e2e/013-tactical-training-cycles.spec.ts` — fixture constant
  10 → 11.

Modify (tests):

- `src/domain/analysis/summaryDerivation.test.ts` — fixture
  `detectionVersion` values that are meant to be current must equal
  `DETECTION_VERSION`; add the exclusivity cases.
- `src/domain/analysis/summary.test.ts` — stale-vs-current count cases.
- `src/domain/statistics/fixtures/phase.test.ts` + `builders.ts` — add a
  current-version exclusive record and assert exclusion from numerators
  while the denominators keep it.
- `src/domain/statistics/fixtures/gameMetrics.test.ts` — a game whose
  only blunder is an exclusive ply is not a `gamesWithBlunderShare`
  member.
- `src/pages/GameReviewPage.test.tsx` — flip the double-annotation test
  to single-X, flip `summary-user-blunder-value` 1 → 0, add the stale
  fallback assertion.
- `src/infrastructure/puzzles/puzzleGenerationService.test.ts` — a
  current-version verified candidate that is also a user blunder yields
  exactly one puzzle; a stale candidate yields the blunder row.
- `tests/e2e/game-analysis-review.spec.ts` — single-X assertions (§8).

## 7. Staged sequence (narrow gates)

Each stage ends with its focused tests before the next stage.

### Stage 1 — Derivation seam + domain count exclusion

Files: `effectiveClassification.ts` (+ test), `summary.ts`,
`summaryDerivation.ts`, `index.ts`, `DETECTION_VERSION` bump in
`types.ts`.

- Implement the seam and the `summarizeAnalysis` exclusion (user side,
  version-gated, denominators/accuracy untouched).
- Update the summary-derivation/summary fixtures so "current" records use
  `DETECTION_VERSION`, then add: exclusive ply absent from all five
  buckets and present in `userMissedTactics`; stale ply counted raw;
  `userMoves` and `accuracyMoves` unchanged.

Gate:

```
npx vitest run src/domain/analysis/effectiveClassification.test.ts src/domain/analysis/summary.test.ts src/domain/analysis/summaryDerivation.test.ts
npx tsc --noEmit
```

### Stage 2 — Game Review presentation (single annotation)

Files: `GameReviewPage.tsx`, `GameReviewPage.test.tsx`.

- Derive `exclusiveMissedByPly`; remove exclusive ids from
  `classificationByPly` after the live/overlay merge; keep
  `effectiveNagOverrides` to `[MISSED_TACTIC_NAG]` for those plies.
- Flip the "classification glyph plus the missed-tactic marker" test to
  assert exactly one `nag-glyph` (`data-nag="9"`, text `X`), no
  `data-nag="4"`, no board chip, no classification square class; flip
  `summary-user-blunder-value` from `1` to `0`; keep the stale
  `detectionVersion` test asserting the raw `??` glyph and count.
- Assert the active-ply missed-tactic label still renders for the
  exclusive ply.

Gate:

```
npx vitest run src/pages/GameReviewPage.test.tsx
npx tsc --noEmit
```

### Stage 3 — Statistics (phase numerators + version)

Files: `phase.ts`, `compute.ts`, `types.ts`, phase/gameMetrics fixtures.

- Thread the current detection version into `summarizeByPhase`; exclude
  exclusive plies from phase error numerators only.
- `gameMetricsFor` needs no logic change; add a fixture test that an
  exclusive-only blunder game is not in `gamesWithBlunderShare` (this
  follows from the persisted summary counts from Stage 1).
- Bump `STATISTICS_VERSION` per §5 and record the exclusivity change in
  the version provenance.

Gate:

```
npx vitest run src/domain/statistics/fixtures/phase.test.ts src/domain/statistics/fixtures/gameMetrics.test.ts src/infrastructure/statistics
npx tsc --noEmit
```

### Stage 4 — Puzzle generation exclusivity

Files: `puzzleGenerationService.ts`, `puzzleGenerationService.test.ts`.

- Exclude candidate-owned plies from `qualifyingUserBlunders`; keep the
  candidate-first ordering.
- Add service tests: current-version verified candidate that is also a
  blunder → exactly one tactical row, `total` counts the ply once;
  stale candidate → ignored, blunder row produced; a blunder with no
  candidate unchanged.

Gate:

```
npx vitest run src/infrastructure/puzzles/puzzleGenerationService.test.ts
npx tsc --noEmit
```

### Stage 5 — E2E single-X + no double glyph

Files: `tests/e2e/game-analysis-review.spec.ts` (and/or a new
`tests/e2e/missed-tactic-exclusivity.spec.ts`), plus the two 013 e2e
fixture constants 10 → 11.

- In the missed-mate proof, replace the "count 2 / NAG 9 count 1"
  assertion with: the owning ply renders exactly one `nag-glyph`, it is
  `data-nag="9"`, and it has no `data-nag="4"`/`"6"`/`"2"` glyph
  (assert no `??` alongside `X`).
- Keep the tolerant branch (no marker when no verified miss) but make
  the marked branch assert the single annotation.
- In the first test, when a marker is present, assert the marked move
  has exactly one glyph (NAG 9) instead of two.

Gate:

```
npx playwright test tests/e2e/game-analysis-review.spec.ts
```

(Playwright only when Chromium is available; otherwise note the skip and
rely on the component test.)

### Stage 6 — Full gate

Run the complete execution policy via the `verify-gate` skill:
`npm run lint`, `npm run typecheck`, `npm run format:check`,
`npm run test`, `npm run build`, `npm run dev` smoke,
`npm run test:browser` (when Chromium is available), `npm audit`.

## 8. Tests

Domain (`effectiveClassification.test.ts`):

- current-version verified miss → exclusive; stale version → raw;
  `missedTactic: false` → raw; `detectionVersion: null` → raw.
- `effectiveClassificationOf` returns `'missedTactic'` for the
  exclusive case and the raw label otherwise.

Summary:

- exclusive user ply absent from all five buckets, present in
  `userMissedTactics`; `userMoves` unchanged; `accuracyMoves` unchanged.
- stale user ply counted in its raw bucket.
- opponent plies never treated as exclusive.

Statistics:

- `summarizeByPhase`: exclusive ply not in phase inaccuracy/mistake/
  blunder numerators and not in `errorsPer100Moves`; still in
  `userMovesInPhase` and `detectedUserMovesInPhase`; counted in
  `missedTactics`.
- `gameMetricsFor`: a game whose only blunder is exclusive contributes
  `0` to blunders/`blundersPerGame` and is not a
  `gamesWithBlunderShare` member; missed-tactic metrics count it.
- `hasBlunders` predicate: the same game reads `no` (via the persisted
  summary counts).

Review component:

- the amended test asserts exactly one annotation (NAG 9 `X`) and no
  classification glyph/colour/highlight for the exclusive ply;
  `summary-user-blunder-value` reads `0`; the Missed-tactics row reads
  `1`.
- stale `detectionVersion` keeps the raw `??` glyph and blunder count.
- live analysis on: an exclusive ply still renders only the X (no live
  classification re-introduces a glyph).

Puzzle generation:

- current-version verified candidate also a user blunder → exactly one
  row (tactical), progress counts the ply once.
- stale candidate → candidate ignored; blunder row produced from raw
  classification.
- non-blunder / opponent / no-best-move plies unchanged.

E2E:

- a fixture game with a real missed tactic: Game Review shows exactly
  one `X` on the owning ply and no `??` glyph on it; the Library row
  blunder count excludes the ply and the Missed-tactics count is `1`.
- Update `game-analysis-review.spec.ts` lines 254-269 and 328-332.

## 9. Migration considerations

- No schema/table change. `MoveAnalysis.classification` is never
  rewritten; the exclusivity is derived at read/summary-build time.
- `DETECTION_VERSION` 10 → 11 marks every completed detection result
  outdated. Existing per-analysis summaries re-derive through the
  existing freshness path: the detection service detects the version
  mismatch, wipes stale candidate rows/annotations, re-runs, and calls
  `buildAnalysisSummary` over the annotated records — now with the
  exclusion applied. The verified set is unchanged, so the re-scan is
  cheap (settled rows and the ADR-018 cache are reused).
- The summary rebuild on pass completion already exists
  (`tacticalDetectionService.writeSummary`), so no new migration hook is
  needed; the classification counts in the rebuilt summary simply
  exclude exclusive plies.
- Stale summaries (no re-scan yet) keep raw counts — correct until a
  fresh pass runs.
- `STATISTICS_VERSION` changes are returned with every statistics
  result; no persisted statistics exist in V1, so no data migration.
- Two e2e fixture files hardcode the detection version (10) and must
  move to 11 with the constant.

## 10. Risks and ambiguities

- **`STATISTICS_VERSION` ordering (W5).** The Feature-014 spec writes
  `3` assuming the ADR-013 time-control bump has already set `2`; the
  repo is at `1`. The plan converges on `3` once both land but the
  exact intermediate value depends on landing order (§5). Confirm W5's
  ordering before committing the bump; if W3 lands first, W5 must end at
  3.
- **"Owner-confirmable" accuracy default.** The spec keeps the exclusive
  ply in the ADR-024 accuracy/`accuracyMoves` weight (default). This
  plan implements the default; excluding it would require an ADR-024
  amendment and `MOVE_ACCURACY_VERSION` bump, which is explicitly out of
  scope.
- **Live analysis overlay.** Exclusivity is applied after the live/overlay
  merge in `classificationByPly`; if a future refactor builds the map
  differently, the suppression could regress. The component test should
  cover the live-on path.
- **Opponent-side stray flag.** The predicate must not exempt an
  opponent ply; the count loops already separate sides, and the
  predicate is applied user-side only. The summary test should include
  an opponent flagged record.
- **`userMoves` semantics.** The persisted summary's `userMoves` is the
  move-exposure denominator and must keep the exclusive ply; changing it
  would shrink the phase denominator (spec forbids this). Assert it
  explicitly.
- **Missed-tactic count with stale flags.** `summarizeAnalysis` counts
  `userMissedTactics` from the flag regardless of version. Detection
  clears stale flags before re-deriving, and the freshness gate hides
  stale results, so this is not a new leak; do not change the count
  semantics in this workstream.
- **E2E tolerance.** The missed-mate e2e depends on real Stage-2
  verification; the marked branch is only taken when a marker exists.
  Keep the tolerant fallback but make the marked branch strictly
  single-X.
- **`hasBlunders` for exclusive-only blunder games.** No predicate code
  change is needed; the behavior follows from the persisted summary.
  If a stale summary predates the version bump, raw counts apply (per
  spec) until the re-scan.

## 11. Acceptance criteria

- [ ] A current-version verified missed-tactic ply has effective state
      `missedTactic`; the persisted label is unchanged and no sixth
      `MoveClassification` exists.
- [ ] Game Review renders exactly one annotation (NAG 9 `X`) — never a
      classification glyph/colour/chip/highlight alongside it.
- [ ] The ply is absent from all five classification counts and from
      inaccuracy/mistake/blunder per-game rates, shares,
      `gamesWithBlunderShare`, `hasBlunders`, and phase error
      numerators.
- [ ] The ply remains in `userMoves`, `userMovesInPhase`,
      `detectedUserMovesInPhase`, and the ADR-024 accuracy set /
      `accuracyMoves` weight; accuracy is unchanged.
- [ ] A stale (`detectionVersion !== DETECTION_VERSION`) marker is
      suppressed: the ply renders/counts as its raw ADR-023 label.
- [ ] Puzzle generation yields exactly one puzzle for a ply that is both
      a current-version verified candidate and a user blunder; a stale
      candidate falls back to the blunder row.
- [ ] `DETECTION_VERSION = 11`; `CLASSIFICATION_VERSION = 2`;
      `STATISTICS_VERSION` converges to `3` with W5;
      `PUZZLE_GENERATOR_VERSION = 2`; `MOVE_ACCURACY_VERSION = 2`.
- [ ] No schema change; the ADR-018 cache is untouched.
- [ ] The full gate passes without warnings.

## 12. Verification commands

Narrow (per stage, in order):

```
npx vitest run src/domain/analysis/effectiveClassification.test.ts src/domain/analysis/summary.test.ts src/domain/analysis/summaryDerivation.test.ts
npx vitest run src/pages/GameReviewPage.test.tsx
npx vitest run src/domain/statistics/fixtures/phase.test.ts src/domain/statistics/fixtures/gameMetrics.test.ts src/infrastructure/statistics
npx vitest run src/infrastructure/puzzles/puzzleGenerationService.test.ts
npx playwright test tests/e2e/game-analysis-review.spec.ts
```

Full gate (load the `verify-gate` skill for the runbook):

```
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev
npm run test:browser
npm run audit
```

## 13. Report

- Plan path: `.opencode/plans/009-w3-missed-tactic-exclusivity.md`.
- Stages: (1) seam + domain counts; (2) Review single annotation;
  (3) statistics phase + version; (4) puzzle-generation input filter;
  (5) e2e single-X; (6) full gate.
- No code, tests, or commits were produced by authoring this plan.
- Expected final versions: `DETECTION_VERSION = 11`,
  `CLASSIFICATION_VERSION = 2`, `STATISTICS_VERSION = 3` (after W5),
  `PUZZLE_GENERATOR_VERSION = 2`, `MOVE_ACCURACY_VERSION = 2`.
