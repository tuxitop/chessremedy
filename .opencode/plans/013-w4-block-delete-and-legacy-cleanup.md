# Plan — W4: Block delete + legacy auto-set cleanup

> Source of truth: `.opencode/specs/features/013-tactical-training-cycles.md`
> (sections "1. Training set model" §1, "3a. Block formation" delete bullet,
> "11. Ownership, archive and deletion", "Legacy auto-set cleanup (one-time)",
> acceptance criteria #10/#16/#26) and
> `.opencode/specs/domain/tactical-training.md` ("Legacy auto sets", the
> TacticalTrainingSet lifecycle, "Pool, Woodpecker block and Quick train").
>
> Required context per `.opencode/CONTEXT-MAP.md` (Feature 013):
> `ARCHITECTURE.md` §7/§9/§10; ADRs `decisions/ADR-031` (cycle-based training,
> no scheduler) and `decisions/ADR-025` (difficulty ordering default). This
> slice adds **no** dependency and **no** schema version.
>
> This is a **plan only**: no application code, tests, or commits are produced
> by this task. Implementation proceeds stage by stage, each stage with its own
> narrow gate; the full project gate runs last.

---

## 1. Objective

Close the two remaining Feature-013 gaps left by the current block model
implementation:

1. **Delete block.** Make `TrainingSetsService.delete` **kind-agnostic**: a
   Woodpecker block — open or closed, with or without an `inProgress` cycle —
   is deletable and cascades its `trainingCycles` + `puzzleAttempts` rows
   through the existing `trainingSetsRepository.delete(id)` transaction.
   Rename/config/membership/archive (and `unarchive`) keep returning the typed
   `auto-set-immutable` refusal. Add the **Delete block** destructive action to
   `SetDetailPage.tsx`, distinct from Finish/Abandon, whose confirmation names
   the block and its cycle/attempt counts. Deleting the open block frees the
   single open-block slot.

2. **Legacy auto-set cleanup.** Add a **one-time, idempotent, guarded**
   infrastructure bootstrap step that deletes the pre-block-model persisted
   `trainingSets` rows `auto:all-puzzles` and `auto:woodpecker-random` (plus
   their cascaded cycles/attempts) using the same set-delete transaction,
   guarded by the persisted settings marker `training.legacyAutoSetsCleaned`.
   It is **not** a Dexie migration: `PERSISTENCE_SCHEMA_VERSION` stays **10**.

3. **Recipe-aware block detection.** Make block identification require
   `source.kind === 'auto'` **and** `source.recipe.kind === 'woodpeckerBlock'`
   in one shared domain predicate, used by the repository `getOpenBlock`, the
   service `isBlock` refusal, and the UI block surfaces, so a legacy `auto` row
   can never be read as the open block even if cleanup fails.

4. **Reaffirm the no-auto-create invariant.** No `ensureAutoSets()` and no
   seeding path is added; the only block-creation path remains the explicit
   `createWoodpeckerBlock`. The cleanup only **deletes**.

---

## 2. Scope

### In scope

- `TrainingSetsService.delete` kind-agnostic; `SetDeleteResult` narrowed;
  recipe-aware service block refusal.
- `DexieTrainingSetsRepository.getOpenBlock`/`isBlockSet` recipe-aware.
- Shared domain predicate `isWoodpeckerBlock` (+ `WoodpeckerBlockSet`) and a
  defensive `setSourceLabel` for a malformed/legacy `auto` source.
- `SetDetailPage` **Delete block** button + destructive confirmation (counts,
  distinct from Finish/Abandon); adoption of the predicate in `SetCard`,
  `SetEditorPage`, `CycleSessionPage`.
- `src/infrastructure/training/legacy-auto-set-cleanup.ts` (guarded cleanup)
  plus `src/app/bootstrap.ts` and a `main.tsx` bootstrap await.
- `SETTINGS_KEYS.legacyAutoSetsCleaned` in `src/config/app-config.ts`.
- Tests: domain predicate, repository, service, component, cleanup/bootstrap,
  and two e2e cases (delete block; seeded legacy row removed on reload).
- Deterministic legacy fixtures in `src/domain/training/test-support.ts`.

### Out of scope (do not touch)

- Schema/version changes (`PERSISTENCE_SCHEMA_VERSION` stays 10; no
  `upgrade()` callback, no v11 module).
- Any new dependency (none needed; Dexie/settings already present).
- The cycle lifecycle, metrics, mastery/pool derivation, Quick train, and the
  Feature-012 solve surface (consumed unchanged).
- Custom-set delete UI/semantics (already correct) beyond reusing the same
  service call.
- Sync/tombstones (Feature 016), statistics/dashboard (014/015).
- `ARCHITECTURE.md`'s stale "currently v11" note — pre-existing doc drift,
  unrelated to this slice.

---

## 3. Existing code to reuse (verified anchors)

- `src/infrastructure/db/training-sets-repository.ts`
  - `delete(id)` `:126-136` already opens one `rw` transaction over
    `trainingSets` + `trainingCycles` + `puzzleAttempts`, deletes the set,
    deletes cycles by the `trainingSetId` index, and calls
    `deleteForTrainingSetIds([id])`. **Reuse verbatim** for both block delete
    and legacy cleanup.
  - `getOpenBlock()` `:101-104` and `isBlockSet()` `:168-171` currently key on
    `source.kind === 'auto'` only — the two functions to make recipe-aware.
- `src/infrastructure/db/attempts-repository.ts`
  - `deleteForTrainingSetIds(trainingSetIds)` `:146-154` deletes attempts by the
    `trainingSetId` index; legacy attempts carry the legacy set id, so the
    cascade already covers them.
- `src/infrastructure/db/training-cycles-repository.ts`
  - `listForSet`, `updateStatus`, `deleteForSet` — no change; the set-delete
    transaction removes cycles directly.
- `src/infrastructure/training/training-sets-service.ts`
  - `delete(id)` `:426-442` (remove the `isBlock` refusal at `:437-439`).
  - `isBlock(set)` `:500-503` (replace with the shared predicate).
  - `closeBlock` `:373-396` and `mutate` `:484-497` keep the block refusal.
  - `SetDeleteResult` `:178-179`, `AutoSetImmutable` `:148-156` (doc comment
    update).
- `src/infrastructure/db/settings-repository.ts` — `get`/`set`/`remove`/`list`
  (the guard marker read/write).
- `src/config/app-config.ts` — `SETTINGS_KEYS` `:13-23` (add the marker key);
  `PERSISTENCE_SCHEMA_VERSION = 10` `:10` (unchanged).
- `src/domain/training/set.ts` — `setSourceLabel` `:189-201` (harden the
  `auto` branch).
- `src/domain/training/autoSet.ts` — home of block vocabulary
  (`DEFAULT_BLOCK_SIZE`, `QUICK_TRAIN_SET_ID`, `formWoodpeckerBlock`); add the
  predicate here.
- `src/pages/SetDetailPage.tsx`
  - `confirmDeletion` `:242-251`; `confirmDelete` state `:109`; existing
    `ConfirmDialog` usage `:562-575`; block manage section `:508-536`;
    `isBlock`/`blockRecipe` `:318-319`; counts `data.cycles.length` /
    `data.attemptCount` `:135-146`.
- `src/components/puzzles/cycles/ConfirmDialog.tsx` — `details`, `testId`
  prefix (`-details`, `-confirm`, `-cancel`), Escape-to-cancel.
- `src/components/puzzles/cycles/SetCard.tsx` `:40-41`; `SetEditorPage.tsx`
  `:168`; `CycleSessionPage.tsx` `:136-139` — predicate adopters.
- `src/main.tsx` `:11-15` — the app entry (no async bootstrap exists today);
  `src/app/` holds `router.tsx`/`routes.ts` only, so `bootstrap.ts` is new.
- `src/domain/training/test-support.ts` — `setFixture` `:252-264`,
  `blockSetFixture` `:431-439`, `cycleFixture`, `cycleAttemptFixture` for the
  legacy fixtures.

---

## 4. Files/modules to create or modify (stage-ordered) + narrow gates

Stages are dependency-ordered: 1 → 2 → 3 → 4; 5 depends on 1+2+3; 6 depends on
4+5; 7 last. Each stage lands independently with its own tests and narrow gate.

### Stage 1 — Domain: recipe-aware block predicate + defensive source label

**Create/modify**

- `src/domain/training/autoSet.ts` — add:
  - `export type WoodpeckerBlockSet = TacticalTrainingSetRow & { readonly source: { readonly kind: 'auto'; readonly recipe: BlockRecipe } };`
  - `export function isWoodpeckerBlock(set: TacticalTrainingSetRow): set is WoodpeckerBlockSet`
    returning `set.source.kind === 'auto' && set.source.recipe?.kind === 'woodpeckerBlock'`.
    The optional chain is deliberate: persisted rows are untrusted, so a legacy
    `{ kind: 'auto' }` row without a `recipe` must return `false` (spec §1,
    Conflict 7). No lint rule forbids the optional chain (verified
    `eslint.config.js` uses `tseslint.configs.recommended`, not
    `strict-type-checked`).
- `src/domain/training/index.ts` — export `isWoodpeckerBlock` and the
  `WoodpeckerBlockSet` type.
- `src/domain/training/set.ts` — harden `setSourceLabel`'s `auto` branch so a
  missing/malformed `recipe` cannot throw: read `recipe?.size` defensively and
  fall back to `'Woodpecker block'`. This is required because recipe-aware
  detection routes a legacy `auto` row to the custom-set rendering path.
- `src/domain/training/autoSet.test.ts` — predicate cases: real block → true;
  `manual`/`game`/`pool` → false; legacy `{ kind: 'auto' }` without a recipe →
  false; `{ kind: 'auto', recipe: { kind: 'notWoodpecker' } }` → false.
- `src/domain/training/set.test.ts` — `setSourceLabel` legacy/malformed source
  does not throw and labels without a size.
- `src/domain/training/test-support.ts` — add
  `legacyAutoSetFixture(id, overrides?)` building a `setFixture` with
  `source: { kind: 'auto' } as unknown as SetSource` (documents the untrusted
  legacy shape; `source` is cast because the current `SetSource` union requires
  a recipe for `auto`).

**Narrow gate**

```sh
npm run test -- src/domain/training/autoSet.test.ts src/domain/training/set.test.ts
npm run typecheck
```

### Stage 2 — Repository: recipe-aware open block + block delete cascade

**Create/modify**

- `src/infrastructure/db/training-sets-repository.ts`
  - Replace `isBlockSet` with `isWoodpeckerBlock` (imported from
    `@/domain/training`) and use it in `getOpenBlock()` `:101-104`.
  - Update the `delete(id)` JSDoc `:49-54` to say "set or Woodpecker block,
    open or closed" (behavior is unchanged and already kind-agnostic).
  - Update the `getOpenBlock()` JSDoc `:55-60` to state the recipe check.
- `src/infrastructure/db/training-sets-repository.test.ts`
  - `getOpenBlock` returns the real `blockSetFixture` and **ignores** an active
    `legacyAutoSetFixture('auto:all-puzzles')` seeded alongside it.
  - Add a block-delete cascade case: seed a `blockSetFixture` with two cycles
    and attempts, delete by id, assert the block + its cycles + attempts are
    gone, the puzzles and a sibling custom set are untouched.

**Narrow gate**

```sh
npm run test -- src/infrastructure/db/training-sets-repository.test.ts
npm run typecheck
```

### Stage 3 — Service: kind-agnostic delete + recipe-aware refusal

**Create/modify**

- `src/infrastructure/training/training-sets-service.ts`
  - `delete(id)` `:426-442`: drop the `isBlock(existing)` branch; keep the
    `not-found` check; call `this.sets.delete(id)`; return `{ ok: true }`.
    Update the JSDoc to state a block (open or closed) is deletable and
    Finish/Abandon still archive.
  - Replace the local `isBlock` `:500-503` with `isWoodpeckerBlock` imported
    from `@/domain/training`; keep using it in `closeBlock` `:378` and `mutate`
    `:489`.
  - Narrow `SetDeleteResult` `:179` to
    `{ readonly ok: true } | SetNotFound`; keep `AutoSetImmutable` exported
    (still used by `SetMutationResult`). Update the `AutoSetImmutable` doc
    comment `:148-156` to note delete is allowed.
- `src/infrastructure/training/index.ts` — no new export required
  (`AutoSetImmutable`, `SetDeleteResult` remain); adjust doc comments only if
  needed.
- `src/infrastructure/training/training-sets-service.test.ts`
  - In "refuses every mutation of a Woodpecker block except closeBlock"
    `:406-435`: remove the `delete` refusal assertion; rename the test to state
    delete is allowed while rename/config/archive/unarchive are refused.
  - Add "deletes an open block with an `inProgress` cycle and cascades its
    cycles/attempts": create a block, create an `inProgress` cycle + attempt,
    `delete(block.id)` → `{ ok: true }`; assert the set/cycle/attempt rows are
    gone, `getOpenBlock()` is `undefined`, the puzzles remain, and a fresh
    `createWoodpeckerBlock` now succeeds (slot freed).
  - Add "deletes a closed block": close a block, delete it, assert removal.
  - Add "a legacy active auto row is not treated as a block and does not block
    creation": seed `legacyAutoSetFixture('auto:all-puzzles')` via the
    repository, assert `service.listPool()`/`createWoodpeckerBlock` are not
    affected and `service.delete('auto:all-puzzles')` succeeds.
  - Add "exposes no `ensureAutoSets`" (`expect('ensureAutoSets' in service).toBe(false)`).

**Narrow gate**

```sh
npm run test -- src/infrastructure/training/training-sets-service.test.ts
npm run typecheck
```

### Stage 4 — UI: recipe-aware detection + Delete block

**Create/modify**

- `src/pages/SetDetailPage.tsx`
  - `isBlock = isWoodpeckerBlock(set)`; derive `blockRecipe` defensively.
  - In the block manage section `:508-536`, keep Finish/Abandon for `active`
    and the closed note for `archived`, and **always** render a `Delete block`
    button (`data-testid="set-detail-delete-block"`). It sets the existing
    `confirmDelete` state.
  - Render the destructive dialog from `confirmDelete`: for a block use
    `testId="set-detail-delete-block-dialog"`, title `Delete “<name>”?`,
    message stating the block, its cycles and recorded attempts are permanently
    removed while the puzzles are kept and it cannot be undone, `details` of
    `${cycles} cycle(s)` + `${attemptCount} recorded attempt(s)`,
    `confirmLabel="Delete block"`; for a custom set keep the current
    `set-detail-delete-dialog`. Reuse `confirmDeletion` `:242-251` (which
    navigates to `ROUTES.puzzles`).
- `src/components/puzzles/cycles/SetCard.tsx` — `isBlock = isWoodpeckerBlock(set)`;
  `blockSize = isBlock ? set.source.recipe.size : null` (recipe access only
  when the predicate is true).
- `src/pages/SetEditorPage.tsx` — replace `set.source.kind === 'auto'` `:168`
  with `isWoodpeckerBlock(set)` for the read-only block path.
- `src/pages/CycleSessionPage.tsx` — replace `resolvedSet.source.kind === 'auto'`
  `:137` with `isWoodpeckerBlock(resolvedSet)` for the spacing nudge.
- `src/pages/TrainingHomePage.tsx` — leave the `source.kind !== 'auto'` filter
  `:472` unchanged: any `auto` row (legacy or real) is never listed as a custom
  set; a legacy row is additionally excluded from the open block by the
  recipe-aware repository read.
- `src/pages/SetDetailPage.test.tsx`
  - Add "deletes an open block after a confirmation naming it and its
    cycle/attempt counts": seed a block + a completed cycle + one attempt,
    open detail, click `set-detail-delete-block`, assert the dialog title names
    the block and `-details` shows `1 cycle` / `1 recorded attempt`, confirm,
    assert the block row is gone and navigation lands on the training-home stub.
  - Add "deletes a closed block": finish then delete; assert removal.
  - Update the existing "renders a block read-only …" test `:201-225` to assert
    `set-detail-delete-block` is present (the custom `set-detail-delete` stays
    absent).
- `src/components/puzzles/cycles/SetCard.test.tsx` — add a legacy
  `{ kind: 'auto' }` (no recipe) case: no block badge and no crash.

**Narrow gate**

```sh
npm run test -- src/pages/SetDetailPage.test.tsx src/components/puzzles/cycles/SetCard.test.tsx
npm run typecheck
npm run lint
```

### Stage 5 — Infrastructure: guarded legacy cleanup + bootstrap

**Create**

- `src/infrastructure/training/legacy-auto-set-cleanup.ts`
  - `export const LEGACY_AUTO_SET_IDS = ['auto:all-puzzles', 'auto:woodpecker-random'] as const;`
  - `LegacyAutoSetCleanupDeps { sets: Pick<TrainingSetsRepository, 'get' | 'delete'>; settings: Pick<SettingsRepository, 'get' | 'set'> }`.
  - `LegacyAutoSetCleanupResult { status: 'cleaned' | 'already-clean' | 'failed'; removed: number }`.
  - `runLegacyAutoSetCleanup(deps)`:
    1. read `SETTINGS_KEYS.legacyAutoSetsCleaned`; if `true` →
       `{ status: 'already-clean', removed: 0 }`;
    2. for each legacy id, `get` then (when present) `delete`, counting removals
       (a row whose cycles/attempts are already gone is still removed);
    3. write the marker `true` **after** success;
    4. catch any error → `{ status: 'failed', removed: 0 }` and **no marker**
       (best-effort; next startup retries). Never throws.
  - Deletion reuses `trainingSetsRepository.delete(id)`, so the existing
    cycles/attempts transaction is the only cascade.
- `src/app/bootstrap.ts` — `export async function bootstrap(deps?)` that awaits
  `runLegacyAutoSetCleanup` with the singleton repositories and swallows any
  rejection (never blocks startup). Accept an optional deps override for tests.
- `src/infrastructure/training/legacy-auto-set-cleanup.test.ts`
  - fresh DB (no legacy rows): `{ status: 'cleaned', removed: 0 }`, marker
    written, `trainingSets` stays empty (no auto-create).
  - seeded legacy `auto:all-puzzles` + `auto:woodpecker-random` rows with cycles
    and attempts, alongside a custom set, an open block, and unrelated puzzles:
    after cleanup only the two legacy ids and their cycles/attempts are gone;
    everything else is byte-identical; marker written.
  - second run → `already-clean`, no-op.
  - a legacy row with its cycles/attempts already removed is still deleted.
  - marker already `true` with legacy rows present → skipped (guard honored).
  - injected throwing `delete` → `{ status: 'failed' }`, marker **not** written,
    no other data touched.
- `src/app/bootstrap.test.ts`
  - resolves even when the cleanup dep throws; wires the default deps.

**Modify**

- `src/config/app-config.ts` — add
  `legacyAutoSetsCleaned: 'training.legacyAutoSetsCleaned'` to `SETTINGS_KEYS`.
  No schema change.
- `src/infrastructure/training/index.ts` — export
  `LEGACY_AUTO_SET_IDS`, `runLegacyAutoSetCleanup`, and the result/deps types.
- `src/main.tsx` — import `bootstrap` from `./app/bootstrap`; call
  `await bootstrap()` before `createRoot(...).render(...)` (e.g. an async
  `start()` invoked with `void start()`), so the cleanup is awaited before any
  route — including the training surfaces — mounts. `bootstrap` never rejects,
  so a storage failure still renders the app.

**Narrow gate**

```sh
npm run test -- src/infrastructure/training/legacy-auto-set-cleanup.test.ts src/app/bootstrap.test.ts src/App.test.tsx
npm run typecheck
npm run lint
```

### Stage 6 — End-to-end

**Create/modify**

- `tests/e2e/013-woodpecker-block.spec.ts`
  - Extend `seedIndexedDb` to optionally write `trainingSets` rows and to
    delete the `training.legacyAutoSetsCleaned` settings marker (include the
    `trainingSets`/`settings` stores in the seed transaction).
  - Test "deletes an open block from its detail page and frees the slot":
    create a block through the UI, open its detail, click
    `set-detail-delete-block`, assert the dialog names the block and shows the
    cycle/attempt counts, confirm; assert navigation to `/puzzles`, the raw
    `trainingSets` row is gone, `trainingCycles`/`puzzleAttempts` for it are
    gone, the puzzles remain, and `training-block-create` is available again.
  - Test "removes seeded legacy auto sets on reload before the training home
    renders": first `goto('/puzzles')` (fresh boot writes the marker), then seed
    `auto:all-puzzles`/`auto:woodpecker-random` rows with cycles/attempts plus a
    custom set and a real open block, and **delete the marker**; `reload()`;
    assert the training home renders, the two legacy rows and their
    cycles/attempts are gone from raw IDB, the custom set and open block remain,
    and the marker is `true`.
- No changes to `tests/e2e/013-tactical-training-cycles.spec.ts`.

**Narrow gate (Chromium required)**

```sh
npm run test:browser -- tests/e2e/013-woodpecker-block.spec.ts
```

### Stage 7 — Full gate

No new files. Run the full project gate (see §12). Confirm schema stays v10,
no dependency was added, and `git status` shows only intended files.

---

## 5. Domain/data changes

- **New domain predicate** `isWoodpeckerBlock` (and `WoodpeckerBlockSet`) is the
  single canonical recipe-aware block check (spec §1): block ⇔
  `source.kind === 'auto' && source.recipe.kind === 'woodpeckerBlock'`.
- **`setSourceLabel` hardening**: an `auto` source without a usable recipe is
  labelled `'Woodpecker block'` (no size) instead of throwing.
- **No stored-shape change**: the block recipe stays in `source`, membership in
  `puzzleIds`, open/closed in `status`; the legacy marker is a `settings` row
  (`{ key, value, updatedAt }`), not a new table/column.
- **No mastery/pool/cycle semantics change.** The cleanup deletes only rows and
  never creates one; the no-auto-create invariant is unchanged and explicitly
  tested.
- **`SetDeleteResult`** narrows to `{ ok: true } | SetNotFound`;
  `AutoSetImmutable` remains for mutations.

---

## 6. UI changes

- **Block detail (`SetDetailPage`)** gains a destructive **Delete block**
  control for both open and closed blocks, with its own dialog test id and copy
  distinct from Finish/Abandon, naming the block and its cycle/attempt counts.
  Finish/Abandon continue to archive and preserve history.
- **Recipe-aware rendering** in `SetCard`, `SetDetailPage`, `SetEditorPage`,
  `CycleSessionPage` so a malformed/legacy `auto` row is never badged as a
  block, never drives the spacing nudge, and never crashes.
- No new route, no navigation change (delete returns to `/puzzles`).
- Accessibility: the delete control is a real labelled button; the dialog is the
  existing `ConfirmDialog` (Escape cancels, focus moves in, counts are text).

---

## 7. Infrastructure changes

- **Cleanup module** `legacy-auto-set-cleanup.ts` (infrastructure) using the
  existing `trainingSetsRepository.delete` transaction; guarded by the settings
  marker; idempotent; best-effort (never throws, marker only on success).
- **Bootstrap seam** `src/app/bootstrap.ts`, awaited in `src/main.tsx` before
  the first render so the training surfaces never read `trainingSets` before
  the cleanup. No `database.ts`/Dexie migration change; no v11.
- **Settings key** added to `SETTINGS_KEYS`; the settings table already exists
  (schema v1) and needs no change.
- No new dependency; `npm audit` unaffected.

---

## 8. Tests

| Layer      | File                                                          | Cases                                                                                                                            |
| ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Domain     | `src/domain/training/autoSet.test.ts`                         | predicate true/false incl. legacy no-recipe and unknown recipe                                                                   |
| Domain     | `src/domain/training/set.test.ts`                             | `setSourceLabel` legacy/malformed source does not throw                                                                          |
| Repository | `src/infrastructure/db/training-sets-repository.test.ts`      | recipe-aware `getOpenBlock`; block-delete cascade                                                                                |
| Service    | `src/infrastructure/training/training-sets-service.test.ts`   | delete open/closed block + in-progress cycle; slot freed; recipe-aware refusal; no `ensureAutoSets`                              |
| Infra      | `src/infrastructure/training/legacy-auto-set-cleanup.test.ts` | fresh no-op; seeded removal + cascade; idempotent second run; orphaned legacy row; marker guard; failure leaves marker unwritten |
| Bootstrap  | `src/app/bootstrap.test.ts`                                   | best-effort swallow; default wiring                                                                                              |
| Component  | `src/pages/SetDetailPage.test.tsx`                            | delete open block dialog counts + removal; delete closed block; delete control present                                           |
| Component  | `src/components/puzzles/cycles/SetCard.test.tsx`              | legacy no-recipe row renders without badge/crash                                                                                 |
| E2E        | `tests/e2e/013-woodpecker-block.spec.ts`                      | UI block delete + cascade; seeded legacy row removed on reload before home renders                                               |

Fixtures: `legacyAutoSetFixture` in `src/domain/training/test-support.ts`; reuse
`blockSetFixture`, `setFixture`, `cycleFixture`, `cycleAttemptFixture`.

---

## 9. Migration considerations

- **No schema bump.** `PERSISTENCE_SCHEMA_VERSION` stays `10`; no `upgrade()`
  callback, no `schema/v11.ts`, no backfill. The cleanup is a runtime data
  remediation, not a migration.
- The settings marker is a normal settings row; an existing install that has
  never run the new build has no marker, so the first launch runs the cleanup.
- Existing legacy rows are removed by deterministic id; custom sets, current
  blocks (generated ids + `woodpeckerBlock` recipe), puzzles, games and
  analyses are untouched. If the cleanup is interrupted, the marker is absent
  and the next launch retries safely (idempotent).
- Feature 016 need not tombstone cleanup removals (legacy rows predate sync and
  never appear in a synced envelope); deterministic ids make the removal
  reproducible on any device holding them.

---

## 10. Risks & ambiguities

1. **Marker vs. e2e seeding order.** A fresh boot writes
   `training.legacyAutoSetsCleaned = true`; the e2e therefore must seed the
   legacy rows **and delete the marker** before reloading to simulate an upgrade
   that already holds legacy rows. Documented in Stage 6; no production impact.
2. **Bootstrap placement.** The repo has no composition root today; this plan
   introduces `src/app/bootstrap.ts` awaited in `main.tsx` (true entry, runs
   before any route mounts). Alternative (an `AppShell` mount gate) is rejected
   because the spec places cleanup in the infrastructure/bootstrap layer.
   Awaiting one bounded IDB transaction before first paint is acceptable.
3. **Recipe-aware detection vs. legacy rows.** After detection becomes
   recipe-aware, a legacy `auto` row is no longer a block; `setSourceLabel`
   must be hardened or a directly-opened legacy row could throw. Included in
   Stage 1. `TrainingHomePage`'s `!== 'auto'` filter is intentionally left so a
   legacy row is never listed as a custom set.
4. **Best-effort cleanup failure.** If the transaction fails, the marker is not
   written and the legacy rows remain visible only to raw storage; the training
   home hides non-recipe `auto` rows and `getOpenBlock` ignores them, so the app
   degrades without crashing. Next launch retries.
5. **`SetDeleteResult` narrowing.** Only `SetDetailPage.confirmDeletion` checks
   `result.ok`; no consumer branches on `auto-set-immutable` for delete
   (verified by grep). The custom-set delete copy should read "set or block"
   when a block is deleted; keep the existing generic not-found message.
6. **ARCHITECTURE.md doc drift.** `ARCHITECTURE.md` §7 says "currently v11"
   while the code and `app-config.ts` are v10. This slice does not touch it and
   stays at v10.
7. **No auto-create.** The cleanup is delete-only and explicitly tested to leave
   `trainingSets` empty on a fresh DB; no `ensureAutoSets` is added.

---

## 11. Acceptance criteria

Mapped to the feature spec's acceptance criteria:

- **#26 / §11 / §3a delete bullet** — a block (open or closed, incl. an
  `inProgress` cycle) can be deleted from its detail page behind a confirmation
  naming it and its cycle/attempt counts; the block row, its cycles and attempts
  are removed in one transaction; puzzles/games/analyses are untouched; delete
  is distinct from Finish/Abandon. **Stage 3 + Stage 4 + Stage 6.**
- **§3a "Deleting the open block frees the slot"** — after deleting the open
  block, `getOpenBlock()` is `undefined` and `createWoodpeckerBlock` succeeds.
  **Stage 3 (service test) + Stage 6.**
- **#16 / "Legacy auto-set cleanup (one-time)"** — a one-time, idempotent,
  guarded startup step removes exactly `auto:all-puzzles` and
  `auto:woodpecker-random` and their cycles/attempts, writes the marker, touches
  nothing else, is not a schema migration, and never creates a row. **Stage 5 +
  Stage 6.**
- **§1 recipe-aware block identity / Conflict 7** — block detection requires
  `source.kind === 'auto'` **and** `recipe.kind === 'woodpeckerBlock'`, so a
  legacy row is never read as the open block. **Stage 1 + Stage 2 + Stage 3 +
  Stage 4.**
- **#10 / no-auto-create invariant** — set deletion cascades cycles/attempts but
  never puzzles; the app never seeds a set/block; the only creation path is the
  explicit one-click action. **Stage 3 + Stage 5.**
- **#23** — no new table/column/index; schema stays v10; no new dependency.
  **All stages (verified in Stage 7).**

---

## 12. Verification commands

Per stage (narrow first), then the full gate from `AGENTS.md` "Execution
policy". Run from the repo root.

```sh
# Stage 1
npm run test -- src/domain/training/autoSet.test.ts src/domain/training/set.test.ts
npm run typecheck

# Stage 2
npm run test -- src/infrastructure/db/training-sets-repository.test.ts
npm run typecheck

# Stage 3
npm run test -- src/infrastructure/training/training-sets-service.test.ts
npm run typecheck

# Stage 4
npm run test -- src/pages/SetDetailPage.test.tsx src/components/puzzles/cycles/SetCard.test.tsx
npm run typecheck
npm run lint

# Stage 5
npm run test -- src/infrastructure/training/legacy-auto-set-cleanup.test.ts src/app/bootstrap.test.ts src/App.test.tsx
npm run typecheck
npm run lint

# Stage 6 (Chromium required)
npm run test:browser -- tests/e2e/013-woodpecker-block.spec.ts

# Stage 7 — full gate
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev            # smoke: /puzzles renders; no browser-console errors
npm run test:browser   # when Chromium is available
npm audit
```

No warnings or errors are acceptable; if one appears, fix the underlying cause
first and only apply a workaround after user confirmation (AGENTS.md "Execution
policy").

---

## Report

- **Plan path:** `.opencode/plans/013-w4-block-delete-and-legacy-cleanup.md`
- **Stage list with files:** see §4 — Stage 1 (domain predicate + label), Stage
  2 (repository), Stage 3 (service), Stage 4 (UI delete block + predicate
  adoption), Stage 5 (cleanup + bootstrap + settings key), Stage 6 (e2e), Stage
  7 (full gate).
- **Narrow-gate commands:** see §4 and §12.
- **Risks/ambiguities:** see §10 (marker vs. e2e seeding order, bootstrap
  placement, recipe-aware legacy handling, best-effort failure, type narrowing,
  pre-existing ARCHITECTURE v11 drift, no-auto-create).
- **No code, tests, or commits were produced**; this task only authored this
  plan file.
