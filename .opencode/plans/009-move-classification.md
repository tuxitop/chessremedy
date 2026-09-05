# Plan — Feature 009 (revised): Move-Classification Presentation & Accuracy Tooling

> Confirmed resolution — **Option A**: `MoveAnalysis.classification` stays
> non-null with the five ADR-023 states (`best`, `good`, `inaccuracy`,
> `mistake`, `blunder`); Feature-008's `classifyMove()` behavior and the
> Feature-008 data model are unchanged. "Unclassified" exists only **in
> presentation** and means an ordinary, non-emphasized move — the `good`
> bucket. The `null`/unclassified state described in
> `specs/domain/classification.md` is **not produced in V1**.

---

## Deliverable 0 — Specification amendment (must land first, as its own change)

No application source is touched in this deliverable. Per AGENTS.md
"Documentation rule", the specs are amended *before* the tooling is
implemented. Exactly two documents are mandatory amendments; a small
consistency touch-up to Feature-008 §17 is recommended (see 0.3).

No change is needed to:

- **ADR-023** — it already mandates the total five-state V1 classifier
  ("V1 classifies every analyzed move into one of …") and never mentions
  `null`.
- **Feature-008 spec §10** — it already lists exactly the five states and
  states that `missedTactic` is *not* a sixth category.
- `specs/domain/analysis-model.md` — its `MoveAnalysis.classification`
  field is already the non-null five-state union.
- `src/domain/chess/classification.ts` / `classifyMove()` — unchanged.

### 0.1 Amend `.opencode/specs/domain/classification.md`

Change the document from a "classification is an optional annotation, `null`
is common" model to the **Option A** model: data is total (five states),
"ordinary" is the `good` bucket, and absence of *visual emphasis* replaces the
concept of absence of *classification*. Prescribed edits:

| # | Location | Existing wording (verbatim) | Replacement wording |
|---|----------|-----------------------------|----------------------|
| 1 | §Purpose, 1st ¶ | "Classification is an annotation applied to a move when the move's quality warrants highlighting. It is NOT a mandatory label for every analyzed move." | "In V1 every analyzed move carries exactly one classification label from the five ADR-023 states: `best`, `good`, `inaccuracy`, `mistake`, `blunder`. `null`/unclassified is **not** a produced data state. Visual emphasis (glyph/highlight) is a *presentation* concern applied only when a move's quality warrants it: ordinary moves are the `good` bucket and are presented without emphasis." |
| 2 | §Classification States, state list | "A move may have: `null` — no classification / `inaccuracy` / `mistake` / `blunder` / `best` / `good`" | "Every analyzed `MoveAnalysis` in V1 carries exactly one of: `best`, `good`, `inaccuracy`, `mistake`, `blunder` (ADR-023). The `null` state is reserved for the concept of *no classification* and is not produced by the V1 classifier." |
| 3 | §Classification States, notes | "`best` and `good` are optional positive classifications and should not be assigned merely because a move is legal or reasonable." / "The absence of a classification is a valid and expected result." | "`best` is assigned only when the played move matches the engine's top choice (or the ADR-023 best-move-tie rule holds); `good` is the ordinary bucket for every other move whose `wpLoss` stays below the inaccuracy threshold. A merely legal or reasonable move is `good`, never `best`. At the **presentation** layer the absence of emphasis on ordinary `good` moves is the valid, expected result." |
| 4 | §Default Behavior, ¶1 | "The classifier should be conservative. / Most ordinary moves should remain unclassified." | "The classifier is total over the five ADR-023 states, but its *presentation* must be conservative: most ordinary moves are classified `good` and are displayed without any classification glyph or emphasis." |
| 5 | §Default Behavior, `e4` example | "For example, an opening move such as `e4` should normally have no classification when it is simply a normal move, even though it may have a very good engine evaluation." | "For example, an opening move such as `e4` is normally `good` when it is simply a normal move, even though it may have a very good engine evaluation; it is presented without emphasis." |
| 6 | §Default Behavior, "do not classify every move" | "Do not classify every move simply because every move has an engine evaluation." | "Do not visually emphasize every move simply because every move carries an engine evaluation and a classification label." |
| 7 | §Default Behavior, "separate concepts" | "The following are separate concepts: engine evaluation; move quality; move classification. / An analyzed move may have an evaluation but no classification." | "The following are separate concepts: engine evaluation; move quality; the persisted five-state classification label; and presentation emphasis. Every analyzed move has an evaluation and a classification label; ordinary (`good`) moves carry no visual emphasis." |
| 8 | §Classification Purpose, last sentence | "Minor or normal evaluation differences should not automatically produce a classification." | "Minor or normal evaluation differences should not automatically produce a visually emphasized classification; they remain ordinary `good` moves." |
| 9 | §Engine Evaluation vs Classification, first example | "Move: e4 / Evaluation: +0.25 / Classification: null" | "Move: e4 / Evaluation: +0.25 / Classification: good (no visual emphasis)" |
| 10 | §Important Constraint, whole section | "Do NOT implement a classifier equivalent to: every analyzed move → best/good/inaccuracy/mistake/blunder. / The expected distribution should contain many unclassified moves and relatively few classified moves." | "The V1 data model is intentionally total (ADR-023): every analyzed move receives one of the five states. The constraint therefore applies to **presentation**: do not render every analyzed move as if it were `best`, `inaccuracy`, `mistake` or `blunder`. The expected *presentation* distribution contains many ordinary (`good`, unemphasized) moves and relatively few visually emphasized moves. Fixtures must validate that the classifier and its presentation behave this way." |

Also append a short note under §Future Extensions:
"A future classifier that intentionally abstains may introduce a `null` state;
that is a new decision requiring a new ADR and a classification-version bump,
not a V1 behavior." (Leave the rest of §Future Extensions untouched.)

### 0.2 Amend `.opencode/specs/features/009-move-classification.md`

The Feature-009 spec still describes the pre-Option-A data model ("A persisted
MoveAnalysis may have no classification"). Rewrite those sections.

**§Goal — keep**, optionally extend with: "Feature 009 never changes
classifications or versions; it consumes the total five-state
`MoveAnalysis` records produced by Feature 008 and defines how the UI
renders and explains them (ordinary `good` moves are not emphasized)."

**§Classification — replace the whole section.** Existing wording
(L21–38): "A persisted MoveAnalysis may have no classification. / The UI
must NOT assume every analyzed move has a classification. / Unclassified
moves: show no classification glyph; remain fully navigable; still have
their engine evaluation available; may still be displayed in the move
list. / Only classified moves receive classification glyphs such as: `?? ? ?! ! !!`. / The exact mapping is defined by ADR-023."

Replacement:

```markdown
## Classification

Every persisted `MoveAnalysis` carries exactly one ADR-023 classification:
`best`, `good`, `inaccuracy`, `mistake` or `blunder`. There is no
`null`/unclassified data state in V1.

"Unclassified" exists only **in presentation**: it denotes ordinary,
non-emphasized moves, which are the `good` bucket.

Ordinary (`good`) moves:

- show no classification glyph;
- remain fully navigable;
- still have their engine evaluation available;
- are still displayed in the move list.

Only classifications whose quality warrants emphasis render glyphs.
The canonical classification→glyph/label/explanation mapping is Feature-009
tooling (single source), based on the ADR-023 states:

| Classification | Glyph (NAG) | Presentation |
|----------------|-------------|--------------|
| `best`         | `!!` (NAG 3) | emphasized   |
| `good`         | none        | ordinary/unemphasized |
| `inaccuracy`   | `?!` (NAG 6) | emphasized  |
| `mistake`      | `?` (NAG 2)  | emphasized  |
| `blunder`      | `??` (NAG 4) | emphasized  |
```

**§Accuracy — keep**, but replace "must not be derived from the presence
or absence of classification glyphs" with "must not be derived from glyph
presence or from which states are emphasized; it is computed from
persisted evaluations per ADR-024."

**§Game Review — keep the first sentence** ("emphasize classified moves
rather than visually classifying every move") — it is already Option-A
correct. Extend with: "Ordinary `good` moves are rendered exactly like
unemphasized moves: no glyph, no highlight, full navigation and stored
evaluation. Review display derives glyphs/labels/explanations from the
canonical Feature-009 mapping and never redefines them locally."

**§Acceptance Criteria — replace every stale item.** Existing → new:

| Existing (L57–68) | Replacement |
|-------------------|-------------|
| "Unclassified moves are supported by the data model." | "Every persisted `MoveAnalysis` carries exactly one of the five ADR-023 classifications; no `null` classification is produced in V1." |
| "Most ordinary moves in representative fixtures remain unclassified." | "Most ordinary moves in representative fixtures are classified `good` and are presented without emphasis." |
| "Opening/book-like ordinary moves are not automatically classified merely because they were analyzed." | "Opening/book-like ordinary moves are `good` and are not visually emphasized merely because they were analyzed." |
| "Classified moves display the appropriate glyph." | "`best`/`inaccuracy`/`mistake`/`blunder` display the canonical glyph; `good` displays none." |
| "Unclassified moves display no classification glyph." | "Ordinary (`good`) moves display no classification glyph." |
| "Evaluation remains available for unclassified moves." | "Evaluation remains available for ordinary (`good`) moves." |
| "Accuracy calculations do not depend on every move having a classification." | "Accuracy is computed from persisted evaluations (ADR-024) and never depends on glyph presence or on classification emphasis." |
| "Classification version is preserved." | unchanged. |
| "Tooling is deterministic over persisted MoveAnalysis fixtures." | "Tooling is deterministic over persisted MoveAnalysis fixtures and never rewrites a stored classification or its version." |

### 0.3 Recommended consistency touch-up — `.opencode/specs/features/008-game-analysis.md` §17

Feature-008 §17, first bullet currently reads: "Each analyzed move displays
its classification glyph (ADR-023: `?? ? ?! ! !!`) read-only; …". Under
Option A ordinary `good` moves must render *no* glyph, so this sentence
would contradict the amended docs. **ADR-023 and Feature-008 §10 stay
untouched** (they are data-model statements); only this *display* bullet is
refined so no contradictory rules remain across specs (Feature-008 AC
"no contradictory … rules remain"):

Replacement: "Each analyzed move that carries a visually emphasized
classification displays its canonical glyph (`best`→`!!`,
`inaccuracy`→`?!`, `mistake`→`?`, `blunder`→`??`); ordinary `good` moves
are rendered without a classification glyph. Glyphs are read-only and come
from the persisted `MoveAnalysis` via the Feature-009 presentation mapping;
classifications are never recomputed in the view."

If the user prefers to keep Feature-008 §17 untouched, the amended
Feature-009 §Game Review text is the governing presentation spec; flag the
decision in the commit message. (Nothing else in Feature-008 changes.)

---

## 1. Objective

Deliver the Feature-009 "post-008 tooling" per Option A:

1. Canonical, single-source classification **glyph / label / explanation /
   emphasis** mapping that replaces the page-local constants in
   `GameReviewPage.tsx` (`CLASSIFICATION_NAG`).
2. Review display that renders ordinary `good` moves **without** glyphs or
   emphasis, while `best`/`inaccuracy`/`mistake`/`blunder` keep their
   ADR-023 glyphs — consistent with the amended specs.
3. ADR-024 **move-accuracy helpers** (per-move and per-game) plus the
   statistics/classification summary helpers the Feature-009 spec lists.
4. Deterministic `MoveAnalysis` fixtures and tests for all of the above.
5. Spec amendments (Deliverable 0) that keep every document consistent with
   the Option A five-state presentation model.

## 2. Scope

### In scope

- Spec amendment step (Deliverable 0).
- New canonical classification-meta module and migration of consumers.
- Review move-list glyph behavior change: `good` → no glyph/emphasis (stored
  mode **and** the ephemeral live-classification overlay).
- Review summary/legend rendering from canonical labels/explanations.
- ADR-024 accuracy domain helpers: per-move accuracy, per-game accuracy with
  sample count; reuse of `winPercentFromCp`/`cpValueOf`.
- Per-game statistics helpers consumed by Features 008 (review polish) /
  014 / 015 (i.e. the existing classification-count summary plus accuracy).
- Deterministic fixtures and unit/component tests.
- e2e review smoke update only if glyph assertions become invalid.

### Out of scope

- Changing `classifyMove()`, ADR-023 thresholds, `classificationVersion`,
  the Feature-008 pipeline, or the stored data model.
- Database/schema changes (nothing to migrate).
- Full statistics aggregation layer (Feature-014), dashboard (015).
- Missed-tactic (`missedTactic`) markers, NAG-9 rendering decisions
  (Feature-010).
- Live-Analysis default glyph rendering beyond what Review's shared move
  list already shows (no classification is computed by Live Analysis).

## 3. Existing code to reuse

- `src/domain/chess/classification.ts` — `winPercentFromCp()`,
  `cpValueOf()`, `CLASSIFICATION_VERSION`, `WPLOSS_*` constants; **not
  modified**, but accuracy helpers import its exports.
- `src/domain/chess/analysis.ts` — `MoveClassification`, `MoveAnalysis`,
  `EvalCpMate` types (already five-state/non-null).
- `src/domain/analysis/summary.ts` — `summarizeAnalysis`,
  `CLASSIFICATION_LABELS`, `ClassificationCounts`; Feature-009 canonical
  labels live with or re-export through this module (see §4).
- `src/domain/analysis/test-support.ts` — `makeMove`, `makeRecords`,
  `TEST_ENGINE` for deterministic fixtures.
- `src/pages/GameReviewPage.tsx` — the page-local `CLASSIFICATION_NAG`
  constant, `buildNagOverrides()`, live `liveOverlay` nag override, and
  `ReviewSummary`/`SummarySide` (to be re-pointed at the canonical module).
- `src/components/chessboard/MoveList.tsx` — already consumes
  `nagOverrides: Map<plyId, readonly number[]>`; empty array ⇒ no glyph.
  No change required.
- `src/components/chessboard/pgnAnnotations.ts` — `NAG_META` maps NAG
  numbers to glyph/color/tone; canonical mapping emits NAG numbers only, so
  glyph text/color stays in one presentation place.
- Existing review tests (`GameReviewPage.test.tsx`, `MoveList.test.tsx`) and
  the Feature-008 e2e (`tests/e2e/game-analysis-review.spec.ts`) seed
  fixtures that are updated, not replaced.

## 4. Files/modules to create or modify

### Specs (first — Deliverable 0)

- `specs/domain/classification.md` — amend per §0.1.
- `specs/features/009-move-classification.md` — amend per §0.2.
- `specs/features/008-game-analysis.md` — optional §17 bullet consistency
  touch-up per §0.3.
- No ADR, analysis-model, or database-schema text changes.

### Source — new

- `src/domain/analysis/classificationMeta.ts` — canonical, framework-free
  classification presentation mapping:
  - `CLASSIFICATION_NAG: Readonly<Record<MoveClassification, number | null>>`
    = `{ best: 3, good: null, inaccuracy: 6, mistake: 2, blunder: 4 }`.
  - `nagForClassification(c): number | null` (null ⇒ no glyph/emphasis).
  - `isEmphasized(c): boolean` (`true` for every state except `good`).
  - `CLASSIFICATION_LABEL_TEXT: Record<MoveClassification, string>`
    ("Best move", "Good", "Inaccuracy", "Mistake", "Blunder").
  - `CLASSIFICATION_EXPLANATION: Record<MoveClassification, string>`
    short, deterministic explanation copy (shown in summary/legend/aria).
  - Re-export/own `CLASSIFICATION_LABELS` ordering (currently in
    `summary.ts`) so there is one canonical order; `summary.ts` re-exports
    it for back-compat.
  - Pure functions only — no React/DOM/DB imports.
- `src/domain/analysis/accuracy.ts` — ADR-024 helpers:
  - `moveAccuracy(record | evalBefore, evalAfter): number | null` using the
    Lichess formula `accuracy = clamp(0,100, 103.1668 * exp(-0.04354 *
    wpLoss) - 3.1669)` with `wpLoss` from `winPercentFromCp` and
    mate→±10000 via `cpValueOf`; `null` when inputs are missing.
  - `gameAccuracy(records, userColor, opts?): { accuracy: number | null;
    moves: number }` — unweighted mean of the user's analyzed moves;
    excludes records flagged `inBook` (default; ADR-024) and any record
    without a usable eval pair; returns `accuracy: null` when `moves === 0`.
  - Exports a `MOVE_ACCURACY_VERSION = 1` constant for future aggregate
    storage (ADR-024) without storing anything yet.
- `src/domain/analysis/fixtures/classificationScenarios.ts` — deterministic
  `MoveAnalysis[]` fixtures ("separated from production data") used by
  Feature-009 tests and reusable by later features:
  - a "good-heavy ordinary game" fixture (most moves `good`, a few
    `best`/errors) with exact eval pairs so counts are known;
  - a blunder-game fixture matching the `cc-bullet-blunder` review game
    (f3 `good`, e5 `good`, g4 `blunder`, Qh4# `best`);
  - a fast-profile fixture with `wdlBefore/After = null`;
  - accuracy golden fixtures with precomputed per-move/per-game expected
    accuracy for deterministic assertion.

### Source — modified

- `src/domain/analysis/summary.ts` — keep `summarizeAnalysis`; import /
  re-export canonical `CLASSIFICATION_LABELS` from `classificationMeta.ts`
  (single source; public surface unchanged).
- `src/domain/analysis/index.ts` — export `classificationMeta` and
  `accuracy` public functions/types.
- `src/pages/GameReviewPage.tsx`:
  - Delete the local `CLASSIFICATION_NAG` const (and its `export`).
  - `buildNagOverrides()` → for each persisted mainline ply, set the
    override from `nagForClassification(record.classification)`: `[]` for
    `good` (so even imported PGN NAGs stay hidden behind the classification
    presentation), `[nag]` otherwise.
  - Live ephemeral overlay: same mapping (`liveOverlay` classification →
    `nagForClassification`; `good` ⇒ `[]` so an ordinary live move does not
    light up).
  - `ReviewSummary`/`SummarySide`: use canonical label text and explanation
    (title/aria), keeping existing `data-testid`s (`summary-user-*`,
    `summary-opponent-*`) intact.
- Tests — see §8.

### No change

- `MoveList.tsx`, `pgnAnnotations.ts`, `classification.ts`,
  `analysis.ts`, `build.ts`, repository/database files, engine code.

## 5. Domain/data changes

- **Data model**: none. `MoveAnalysis.classification` is already the
  non-null five-state union; no DB version bump, no migration.
- **Domain rules**: `classifyMove()` and ADR-023 remain untouched. The
  "absence of classification" concept moves from the *domain data model* to
  the *presentation layer* via the new `classificationMeta.ts` module
  (`good` = ordinary; no glyph).
- **New domain helpers**: accuracy (ADR-024) and canonical presentation
  mapping, deterministic and framework-free.
- **Versioning**: nothing recomputed or rewritten; stored
  `classificationVersion` is preserved (tooling is read-only). New
  `MOVE_ACCURACY_VERSION = 1` constant prepared for Feature-014 aggregate
  storage.

## 6. UI changes

- Game Review move list: ordinary `good` moves render **no** glyph (stored
  mode and live-overlay mode); `best`→`!!`, `inaccuracy`→`?!`,
  `mistake`→`?`, `blunder`→`??` continue to render through the existing
  `MoveList` NAG pipeline. This replaces the current behavior where every
  move (including `good`) rendered `!`/`!!` from the page-local constant.
- Review summary counts keep all five buckets (counts remain informative);
  row labels come from the canonical mapping with explanation available via
  `title`/`aria-label` (no test-id churn).
- No board/eval-bar/arrow/layout changes. Live Analysis is unaffected
  (nothing is classified there).
- A11y: emphasized glyphs and summary rows expose the canonical label text;
  nothing relies on color alone (existing `data-testid`s and NAG tone meta
  preserved).

## 7. Infrastructure changes

None. No new dependencies, workers, storage, or network surfaces. The new
modules are pure domain/analysis code.

## 8. Tests

### Spec/domain tests

- `src/domain/analysis/classificationMeta.test.ts` (new):
  - mapping table matches ADR-023/§0.2 (`best`→3, `good`→null, etc.);
  - `isEmphasized('good') === false`, all others true;
  - labels/explanations present and deterministic;
  - `CLASSIFICATION_LABELS` order equals the summary order used today.
- `src/domain/analysis/accuracy.test.ts` (new):
  - winPercent/mate handling matches `classification.test.ts` expectations;
  - per-move accuracy: perfect move ≈ 100; big `wpLoss` → ~0; mate-flip
    handled; clamp `[0,100]`; `null` when eval inputs are missing;
  - known ADR-024 curve anchor points from the documented formula
    (`accuracy = 103.1668·exp(−0.04354·wpLoss) − 3.1669`, clamped; e.g.
    `wpLoss=2 → ≈91.4`, `wpLoss=10 → ≈63.6`, `wpLoss=20 → ≈40.0`);
  - `gameAccuracy`: user-only mean, `inBook` exclusion (default), empty →
    `{ accuracy: null, moves: 0 }`, deterministic over fixtures;
  - fixtures from `fixtures/classificationScenarios.ts` give expected counts
    and accuracy values.
- `src/domain/analysis/fixtures/classificationScenarios.ts` consumed by
  these tests; a `fixtures` self-check test asserts record shapes are valid
  `MoveAnalysis` objects with non-null classifications.
- `src/domain/analysis/summary.test.ts` — unchanged assertions (still green
  after label re-export).

### Component/page tests

- `src/pages/GameReviewPage.test.tsx` — update seeding assertions:
  - f3/e5 (`good`) show **no** `nag-glyph`;
  - g4 (`blunder`) shows `??`/NAG 4 (keep existing assertion);
  - Qh4# (`best`) shows `!!`/NAG 3;
  - summary counts and test-ids unchanged; live-overlay `good`
    classification adds no glyph.
- `src/components/chessboard/MoveList.test.tsx` — add a case proving an
  empty-array override (`[]`) renders no glyph and suppresses tree NAGs
  (existing override mechanics test stays).

### e2e

- `tests/e2e/game-analysis-review.spec.ts` — verify current assertions still
  hold (`g4` → NAG 4; summary). Add, only if stable with the real engine, a
  check that no `!` glyph spam appears on ordinary moves; otherwise rely on
  the deterministic component tests (preferred).

## 9. Migration considerations

- **Data**: zero migration — existing persisted records already carry one of
  the five states and a version. Old records produced before this feature
  render identically after the change except `good` moves lose the `!`
  glyph.
- **Spec**: Deliverable 0 changes `domain/classification.md` semantics from
  "null is common" to "null is not produced in V1" — consumers of that doc
  (Features 009/014, ADR-023 sources) already assume the five-state model;
  the amendments remove the last contradictory paragraphs.
- **Code**: `CLASSIFICATION_NAG` was exported from `GameReviewPage.tsx`; no
  other importer exists (verified). Moving it is safe; keep no duplicate.

## 10. Risks

- **Spec drift**: leaving Feature-008 §17's "each analyzed move displays
  its classification glyph" unchanged would contradict Option A. Mitigated
  by 0.3 (recommended bullet rewrite) and/or the authoritative Feature-009
  §Game Review text.
- **`summary.ts` label re-export**: if other consumers (Feature-014 later)
  import `CLASSIFICATION_LABELS`, keep the re-export for compatibility.
- **Accuracy edge semantics**: ADR-024 excludes book moves from per-game
  accuracy; V1 `inBook` is always `false` (reserved), so the helper's
  default exclusion is inert today but correct for future tagging. The
  first-8-plies opening exclusion mentioned in ADR-024 consequences stays a
  Feature-014 aggregation decision; Feature-009's helper documents but does
  not implement it, to avoid inventing V1 behavior.
- **Review visuals**: changing `good` from `!` to no glyph alters existing
  screenshots/expectations; component tests and (if stable) e2e are
  updated in the same change.
- **Live overlay**: ensure the ephemeral classification overlay never emits
  `[]`→nothing incorrectly when a stored `good` move becomes a live
  `blunder` (it must show the live `blunder` glyph); covered by the live
  overlay test.
- Out-of-date ADR-019 text refers to "the classifier (Feature 009)" although
  Feature 008 owns it. Not part of this feature's scope; flag to the user if
  a doc cleanup commit is wanted.

## 11. Acceptance criteria

1. Deliverable 0 (spec amendments) is committed before source changes, with
   ADR-023 and Feature-008 §10 provably unchanged.
2. `MoveAnalysis.classification` remains non-null/five-state and
   `classifyMove()` is untouched (diff shows no change).
3. A single canonical `classificationMeta` module owns the
   glyph/label/explanation/emphasis mapping; no page-local override remains
   in `GameReviewPage.tsx`.
4. Ordinary `good` moves render with no classification glyph in stored
   review and in the live-overlay path; `best`/`inaccuracy`/`mistake`/
   `blunder` render their ADR-023 glyphs.
5. ADR-024 accuracy helpers (per-move/per-game with sample count) are
   deterministic, reuse `winPercentFromCp`/`cpValueOf`, and never depend on
   glyphs or emphasis.
6. Deterministic fixtures drive the classification/accuracy tests and the
   review display tests.
7. All existing tests keep passing after test updates; lint, typecheck,
   format, build, audit pass; no console errors on a `dev` smoke run.
8. Feature-008 e2e review assertions still pass.

## 12. Verification commands

Run from the repo root, narrowest first, then the full gate
(AGENTS.md Execution policy):

```bash
npx vitest run src/domain/analysis/classificationMeta.test.ts
npx vitest run src/domain/analysis/accuracy.test.ts
npx vitest run src/domain/analysis/summary.test.ts src/domain/analysis/fixtures
npx vitest run src/pages/GameReviewPage.test.tsx src/components/chessboard/MoveList.test.tsx
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev          # manual smoke: review an analyzed game → ordinary moves unemphasized, glyphs on errors/best
npm run test:browser # Chromium available
npm audit
```

Commit order:

1. Deliverable 0 — spec amendments only (commit message notes ADR-023 and
   Feature-008 §10 intentionally untouched).
2. Canonical `classificationMeta` + `summary.ts`/`index.ts` re-pointing.
3. ADR-024 `accuracy.ts` + fixtures.
4. Review display migration (`GameReviewPage.tsx`) + test updates.
5. Full verification gate (§12).
