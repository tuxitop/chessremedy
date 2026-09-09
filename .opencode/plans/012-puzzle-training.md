# Plan — Feature 012: Puzzle Training

> Source of truth: `.opencode/specs/features/012-puzzle-training.md`. Required
> context per `.opencode/CONTEXT-MAP.md`: `ARCHITECTURE.md` (post-solve panel on
> the shared analysis board; ownership & deletion cascade); ADRs
> `decisions/ADR-031`, `decisions/ADR-023`, `decisions/ADR-033`; domain
> `domain/tactical-training.md`, `domain/puzzle-model.md`,
> `domain/analysis-model.md`, `domain/game-library.md`; research
> `research/cycle-training.md`; `PRODUCT.md` §10 (hint levels, authoritative).
>
> Feature 012 is the **solving experience**: presenting an immutable
> Feature-011 `PuzzleRow` inside a hosted session, legal-move entry, per-origin
> answer evaluation against the row's stored solution, hints, wrong-move
> handling, restart/skip/give-up, outcome determination, exactly one
> immutable `PuzzleAttempt` row per presentation outcome (schema **v9**), and
> an engine-free, stored-data-only post-solve step on the shared analysis-board
> surface. Feature 012 never runs the engine, never reads the ADR-018 cache,
> never recomputes classification, never regenerates/re-derives puzzle rows,
> and never computes cycle aggregates. The set/cycle lifecycle, ordering and
> navigation are Feature-013's; 013 (implemented after 012) hosts the solving
> screen shipped here and consumes the attempt rows this feature writes.
>
> This plan is organized as stages A–G (domain → persistence → service/harness →
> solving UI → integration/hand-off seams → test closure → docs/gate). Stages
> are dependency-ordered: A → B → C → D, then E (needs C+D), F (closure over
> A–E), G last. Each stage lands independently with its own tests and a narrow
> gate; the full gate runs at the end.

---

## 1. Objective

Deliver the Feature-012 slice per the spec Goal:

1. **Domain (pure)** — a deterministic presentation/solving engine over a
   stored `PuzzleRow` (`chessops`, ADR-028): per-origin accepted-move sets
   (tactical `{bestMove} ∪ acceptedFirstMoves`; blunder exactly `{bestMove}`),
   branch line-advance with auto-played opponent replies, terminal accepted
   alternatives, wrong-move rejection/counting, promotion/castling/en-passant
   canonical-UCI comparison, line-parity completion; hint-level gating and
   content (PRODUCT §10 levels 1–4, first-move-only, availability/threshold
   config); outcome derivation (`solvedFirstTry`/`solvedWithHelp`/`failed`/
   `skipped`/discard) and the immutable `PuzzleAttemptRow` builder.
2. **Persistence** — schema **v9** `puzzleAttempts` table (additive), one
   immutable row per presentation, natural key `[cycleId, puzzleId,
   presentationIndex]`, indexes for per-cycle/per-puzzle listing and the
   game-deletion cascade (attempts follow their puzzle; no orphans).
3. **Service/harness** — a thin attempt recorder (outcome write with retry and
   first-write-wins idempotency) plus a deterministic **hosted-session
   harness** (test-support, standing in for the Feature-013 host) that drives
   presentations end-to-end over fixture rows.
4. **Solving UI** — a keyboard/touch/AT-operable solving screen (board at
   `startingFen` oriented to `sideToMove`, objective chip, move-line transport,
   restart/hint/skip/give-up/analyze/continue, outcome summary, wall-clock
   timer, pointer-free move entry) and the post-solve step (read-only stored
   analysis-board surface, ADR-033; stored-only divergence annotations).
5. **Hand-off seams** — a documented host contract and public exports for
   Feature 013 (which hosts the screen and consumes attempt rows) with the
   Game Library deliberately untouched (Feature-011's per-game view stays
   read-only; `masteredPuzzleCount` aggregates are 013/014's).
6. Deterministic engine/network/IndexedDB-free fixtures (both origins,
   multi-move, accepted alternatives, promotion) and domain/repository/
   service/component tests. The committed-engine end-to-end proof lands with
   Feature 013 (the e2e host does not exist in 012; spec "End-to-end").

No new runtime dependency (Dependency policy: none added; `chessops/san`
`parseSan` is already used at `moveList.ts:16` / `gameEnd.ts:14`).

---

## 2. Scope

### In scope

- Domain: attempt row model + derived `puzzleId`, presentation solving engine,
  hint-level gating/content, outcome derivation, attempt-row builder,
  deterministic fixtures.
- Schema v9 `puzzleAttempts` table + repository (first-write-wins immutable
  put, per-cycle/per-puzzle reads, cascade); `deleteGames` cascade extension.
- Application service: attempt recorder with retryable-write semantics; a
  test-support hosted-session harness standing in for the 013 host.
- Solving screen components + presentation hook (transient states
  `presenting → solving → outcome → postSolve`), post-solve stored-only panel,
  keyboard move entry, a11y/announcements/focus, responsive mobile layout.
- Public hand-off surface (types + component/service exports) for Feature 013.
- Tests: domain/repository/service/component; no engine, no network, and —
  for domain/component — no IndexedDB.

### Out of scope (restated from the spec; owned elsewhere)

- Training-set / training-cycle lifecycle, ordering, resuming, completion,
  retry-pass scheduling and cycle results — Feature 013 (F012 consumes only
  the ordered queue, per-puzzle context and configuration the host supplies).
- The real entry route/page that mounts the solving screen — Feature 013
  ("the solving screen is driven by a session host contract … Feature 013
  later wires the real entry surfaces and navigation"). F012 ships no route.
- Any engine work, ADR-018 cache reads, or in-view classification recompute
  (ADR-033); the post-solve step is stored-data-only.
- Per-puzzle scheduling / due-review / FSRS (ADR-031).
- Direct ad-hoc solving outside a cycle (e.g. from the read-only per-game
  puzzle list of Feature-011).
- Blunder-difficulty re-rating from solver data (Feature 013).
- Cross-game FEN dedup / transposition merging.
- Game Library row actions/insights of F012's own; `masteredPuzzleCount`
  aggregates (Feature 013/014). Library is a pure read model here.
- Sync of attempt rows as standalone values (Feature-016 tombstones only).
- Mutation of the `puzzles` table or any Feature-011 row.
- Feature-013's `trainingSets`/`trainingCycles` tables (schema v10 when 013
  lands; the v9 attempt-row shape and `cycleId`/`trainingSetId` indexes are
  fixed here so 013 builds on them — §10 R-7).

---

## 3. Existing code to reuse

Concrete anchors verified in code (file:line):

### Domain input (immutable, never modified)

- **`PuzzleRow`** — `src/domain/puzzle/types.ts`: immutable row `:61`;
  `bestMove :80`, `bestPv :86` (UCI tokens, alternating user/opponent), `origin?
  :92` (absent = tactical), `acceptedFirstMoves? :94` (tactical only; absent ⇒
  `{bestMove}`), `difficulty :101`, `puzzleGeneratorVersion :107`,
  `detectionVersion :113`, `candidateGenerationVersion :118`; no scheduling
  state. `PUZZLE_GENERATOR_VERSION = 2` `:37`; `PuzzleOrigin = 'tactical' |
  'blunder'` `:52`.
- **Assembly contract** (what rows actually contain): `assemblePuzzle` copies
  `acceptedFirstMoves` or defaults to `[bestMove]` (`assemble.ts:163-165`);
  blunder rows are one-move (`bestPv = [bestMove]`, `assembleBlunderPuzzle`
  `:104-122`). **No per-alternative continuation is stored on any row** —
  see §10 R-1.
- **Fixtures** — `src/domain/puzzle/test-support.ts`: `puzzleRowFixture(kind)`
  `:181`, `puzzleFixtures` index `:186`, `blunderRowFixture` `:227`; FEN
  corpus `:30-40`. These are the F012 training-input fixtures; F012 adds
  promotion/edge-case rows in its own test-support (Stage A).
- **Objective/difficulty labels** — `src/domain/puzzle/objectiveLabel.ts`
  (`puzzleObjectiveLabel(row)` `:37`, blunder fixed label `:30`);
  `src/domain/puzzle/buckets.ts` (`difficultyBucketOf`). Difficulty must NOT
  be shown while solving (spec "Entering and leaving a presentation").

### Chess domain helpers (ADR-028)

- `src/domain/chess/position.ts` `parsePositionFen` `:17` / `fenOf` `:30`.
- `src/domain/chess/san.ts` `uciPvToSan(fen, uciMoves)` `:21` (SAN rendering
  of stored lines; used by F011's `sanText` precedent in GamePuzzlesPage).
- `chessops/san` `parseSan` import precedent `moveList.ts:16` / `gameEnd.ts:14`
  — the SAN/UCI text move-entry path (pointer-free, §10 R-4); `chessops/util`
  `parseUci` precedent `san.ts:10`.

### Board wrapper (mandatory, Chessground 10.1.x via ADR-002/014)

- `src/components/chessboard/Chessboard.tsx`: controlled `position:
  ChessOpsPosition`, `interactive`, `drawable`, `orientation`, `lastMove`,
  `customSquareClasses`, `autoShapes`, `onMove(from, to)` `:106`,
  `onPromotionRequired` `:113` (+ `PromotionDialog` role resolution),
  `ChessboardHandle.selectSquare` `:67`. Interaction config supports the
  warm-frozen drawable inspection mode (`interactionConfig` `:162`) used by
  F011 and a fully interactive solving board.
- `src/components/chessboard/PromotionDialog.tsx` (`PromotionRole` `:6`) —
  promotion flow precedent in `GameReviewPage.tsx:1071,1149` /
  `LiveAnalysisPage.tsx:329,443`.
- `src/components/chessboard/Navigation.tsx` — reusable four-button transport
  (start/previous/next/last; `NavigationTarget` `:4`, `currentPly`/`totalPlies`
  `:6-12`) matching the spec's move-line transport exactly.
- `src/components/chessboard/MoveListPane.tsx` `:9` — labelled region for the
  post-solve move lists.
- `src/components/chessboard/boardShapes.ts` `uciMoveArrow(uci, brush)` `:33`
  (green solution arrow, red wrong/played arrows).
- `src/components/chessboard/BoardContainer.tsx` + `useBoardSize` (fluid
  mobile sizing) — usage pattern `GamePuzzlesPage.tsx:538-547`.

### Shared analysis-board surface (ADR-033, stored mode)

- `src/components/analysis/board/AnalysisBoard.tsx` — mode-agnostic
  board/bar/side-panel chrome (`AnalysisBoardProps` `:17-36`; `bar={null}`
  omits the eval column). The post-solve step is a **stored, read-only** use
  of this surface: no engine, no cache, no MultiPV config, no in-view
  recompute (spec "Post-solve analysis"; ADR-033).
- Stored source-ply records: `src/infrastructure/db/analysis-repository.ts`
  `listForGameAndAnalysis(gameId, analysisId)` `:51` — the one game-scoped
  lookup the post-solve step needs (`MoveAnalysis` fields per
  `domain/analysis-model.md`: `classification`, `bestMove`, `evalBefore/
  evalAfter`, `wdlBefore/wdlAfter`).
- Presentation metadata for stored annotations: `src/domain/analysis/
  classificationMeta.ts` (`CLASSIFICATION_LABEL_TEXT` `:56`,
  `CLASSIFICATION_EXPLANATION` `:65`) — glyph/eval text rendered only from
  stored records, never recomputed.

### Persistence / cascade conventions

- Schema modules: `src/infrastructure/db/schema/v8.ts` (`applyV8Schema` `:23`;
  additive-table pattern + doc header) and `schema/index.ts`; migration-test
  harness: `v8-migration.test.ts` (hand-built pre-versioned Dexie, table-list
  assertion, repository usable after open).
- Database registration/guard: `src/infrastructure/db/database.ts` (`puzzles`
  table `:43`, `applyV8Schema(this)` `:55`, version guard `:61-67`);
  `src/config/app-config.ts` `PERSISTENCE_SCHEMA_VERSION = 8` `:9` (+ comment
  history `:3-8`).
- Cascade: `src/infrastructure/db/games-repository.ts` `deleteGames` `:240-264`
  (transaction + dependent-kind list: analyses, analysisJobs, analysisSummaries,
  puzzleCandidates, puzzles; engine cache untouched). Attempts join this list.
- Per-kind cascade test: `src/infrastructure/db/game-deletion-cascade.test.ts`;
  table-list test: `database.test.ts` `:18-27` (expects the v8 table list and
  `db.verno === 8`).
- Repository style precedent: `src/infrastructure/db/puzzles-repository.ts`
  (`addIfAbsent` first-write-wins `:61`, list/count/delete `:79-112`).

### Page/service injectable patterns (for the UI + tests)

- `src/pages/GamePuzzlesPage.tsx` — closest sibling: injectable service prop
  `analysisService?: AnalysisServiceLike | null` `:37-40`; data-loading hook
  over repositories `:86-157`; read-only drawable boards with red-played /
  green-solution arrows `:514-547`; SAN text helper `sanText` `:165`; polls
  the live service registries and stops when nothing runs `:210-273`.
- `src/hooks/useGameAnalysis.ts` `AnalysisServiceLike` `:14-88` — the
  injectable-service interface precedent (fakes omit optional members).
- `src/app/router.tsx` lazy-route precedent `:34-36/:55-62` (used by 013, not
  012); `src/app/routes.ts` nav (`puzzles` `:27`); `src/pages/PuzzlesPage.tsx`
  is the F013 placeholder — **untouched in this feature**.
- Test conventions: `vitest.config.ts` (happy-dom, fake-indexeddb auto via
  `src/test/setup.ts`), `src/domain/puzzle/test-support.ts`,
  `src/infrastructure/puzzles/puzzleGenerationService.test.ts` (service
  state-machine tests), committed-engine e2e precedent
  `tests/e2e/011-puzzle-generation.spec.ts` (deferred here to 013).

### Domain/spec statements this feature implements

- `domain/tactical-training.md`: `PuzzleAttempt` row fields `:128-151`, result
  values `:143-147`, lifecycle rules (retries recorded, hints never fail,
  skip never in accuracy) `:103-126`, configuration `:153-181`.
- `PRODUCT.md` §10 (`:285-304`): wrong-move identify + auto-retry; four hint
  levels (piece type → piece highlight → destination → full move), configurable
  first-hint level, no hints beyond level 4 for multi-move solutions.
- `domain/puzzle-model.md` ownership `:111-117`; `domain/game-library.md`
  §8 deletion tree `:264-287`; ARCHITECTURE §7 (`:121-144`) — the
  cascade-ready `deleteGames` list is extended by the introducing milestone.

---

## 4. Stages

### Stage A — Domain: attempt model, solving engine, hints, outcomes, fixtures (pure)

**Aim:** the deterministic, engine/network/IndexedDB-free heart of the feature,
fully testable with no React and no Dexie.

**Files — new:**

- `src/domain/puzzle/id.ts` — the **canonical derived puzzle id** the attempt
  row references (Feature-011 minted no public id — its plan's R-5): 
  `puzzleIdOf(sourceGameId: string, sourcePly: number): string` =
  `` `${sourceGameId}:${sourcePly}` `` and `parsePuzzleId(id)`.
  Documented as the shared reference for F012 attempts and F013 set
  membership. (Additive; no schema/row change.)
- `src/domain/training/types.ts` —
  - `TrainingResult = 'solvedFirstTry' | 'solvedWithHelp' | 'failed' |
    'skipped'` (domain doc `tactical-training.md:143-147`);
  - `HintLevel = 1 | 2 | 3 | 4` (PRODUCT §10);
  - `SolveHintConfig { readonly enabledLevels: readonly HintLevel[];
    readonly firstHintLevel: HintLevel }` (host-supplied set configuration —
    availability and first-hint threshold; spec Hints);
  - `SessionPuzzleContext { readonly trainingSetId: string; readonly
    cycleId: string; readonly presentationIndex: number }` (1-based,
    incremented by the host on re-presentation; spec "Solving-session model");
  - `PuzzleAttemptRow` — immutable persisted shape (spec "Data requirements"):
    `puzzleId`, `trainingSetId`, `cycleId`, `presentationIndex`, `startedAt`,
    `endedAt`, `result: TrainingResult`, `solvingTimeMs`, `wrongMoveCount`
    (the domain's "number of attempts" per `tactical-training.md:138` — doc
    comment maps the terms), `hintCount`, `highestHintLevel: HintLevel | null`,
    `solved: boolean`, `puzzleGeneratorVersion: number`, `origin: PuzzleOrigin`
    (normalized at write time: absent on a pre-v2 row = `'tactical'` — §10
    R-8). All `readonly`.
  - `PresentationOutcome` — what the session returns to the host per
    presentation: the written attempt summary (result, solving time,
    wrong-move count, hints) plus the attempt row reference; `null`-equivalent
    "discarded" is represented by no row (spec "Entering and leaving a
    presentation").
- `src/domain/training/solve.ts` — the pure presentation solver over a stored
  row (`chessops` only):
  - `acceptedMovesOf(row): ReadonlySet<string>` — tactical
    `{bestMove} ∪ acceptedFirstMoves` (absent field ⇒ `{bestMove}`); blunder
    exactly `{bestMove}` (spec "Accepted moves"; F011 one-move contract).
  - `beginPresentation(row, now): BeginResult` — parse `startingFen`
    (`parsePositionFen`); unparseable FEN ⇒ typed error (pipeline defect —
    spec Error cases: the presentation fails to load, session never crashes);
    builds the initial presentation state: `row`, `context` (set by host),
    decision-point `Position`, empty played line, counters zero, `startedAt`.
  - `applyMove(state, uci): MoveResult` — evaluate a canonical-UCI move at the
    current decision point:
    - accepted + branch continues ⇒ append the user token **and** auto-play the
      opponent reply from the chosen stored branch (`bestPv` when `bestMove`,
      else the stored continuation when one exists — none exists in V1, §10
      R-1), advancing to the next decision point; **solved** when the branch's
      user tokens are exhausted (a trailing opponent token is appended for
      display only — line parity, spec Edge cases);
    - accepted alternative with **no stored continuation** ⇒ immediate
      `solved` (terminal alternative contract, AC #3);
    - blunder row: solved when `bestMove` is played (single ply, nothing
      beyond);
    - any other legal move ⇒ `wrong`: board returns to the decision point
      (position unchanged), `wrongMoveCount` + 1, the move is appended to the
      presentation's wrong-moves-tried memory (post-solve "you tried X"), never
      into the played line;
    - illegal moves are never offered by the board; the text path rejects them
      before the domain (§10 R-4) — the domain function itself trusts
      `isLegal`-prechecked input but also guards.
  - Position transport helpers over the played line (view-only):
    `positionAtPly(state, ply)` and `playedLine(state)`; move entry is only
    accepted at the current decision point (end of the line — §10 R-10).
  - `restartPresentation(state)` — clears the played line and revealed hint
    content, returns the board to `startingFen`; **does not** reset the
    wrong-move count, hint counters or clock, does not end the presentation,
    does not create an attempt (spec restart).
  - All UCI comparison is canonical string equality including the promotion
    piece (`e7e8q`); castling and en-passant compare by their canonical UCI
    king/capture tokens; SAN rendering happens via `uciPvToSan`, never here.
- `src/domain/training/hints.ts` —
  - `nextHintLevel(reached, config): HintLevel | null` — starting at the
    config's `firstHintLevel`, skipping disabled levels, capped at level 4;
    `null` when no further enabled level exists. Hints are gated **off** once
    the first solution move has been solved (spec Hints + Edge cases) — the
    reducer simply stops offering the control.
  - `hintContent(level, row, position)` — PRODUCT §10 exact content only:
    L1 "relevant piece type" (from the `bestMove` from-square piece at
    `startingFen`); L2 piece square; L3 destination square of `bestMove`;
    L4 full first solution move as SAN. Returns text + optional squares so the
    UI can render text, board highlights (`customSquareClasses`) and
    announcements. Never reveals anything beyond the first solution move.
  - Using a hint never marks the puzzle failed and never increments the
    wrong-move count (spec Hints).
- `src/domain/training/outcome.ts` —
  - `deriveResult(trigger, counters): TrainingResult` per the spec Outcomes
    table: clean solve (`solvedFirstTry`), solve after any hint/wrong move
    (`solvedWithHelp`), give-up/show-solution (`failed`), explicit skip
    (`skipped`); discard-on-exit writes nothing (no result).
  - `buildAttemptRow({ row, context, trigger, counters, startedAt, endedAt,
    origin, puzzleGeneratorVersion }): PuzzleAttemptRow` — computes
    `solvingTimeMs`, `solved`, `highestHintLevel`, copies
    `puzzleGeneratorVersion`/normalized `origin` (ARCHITECTURE §9).
  - `hintCount`/`highestHintLevel`/`wrongMoveCount` are the only hint/wrong
    data persisted; hint *content* is never persisted (spec Hints).
- `src/domain/training/test-support.ts` — deterministic fixtures:
  - re-exports the F011 puzzle row fixtures (`puzzleRowFixture`,
    `blunderRowFixture`) as the canonical training input;
  - **supplementary F012 rows** (hand-authored legal `PuzzleRow`s, walkable —
    asserted in test-support.test): a promotion row (canonical promotion UCI,
    AC #3/#11), an en-passant/castling comparison row, and rows exercising the
    terminal accepted-alternative contract;
  - `solveConfigFixture()` (all levels enabled, first level 1),
    `attemptRowFixture(...)`, `cycleContextFixture(cycleId, puzzleId,
    presentationIndex)` — shared by Stage C/D/F tests.
- `src/domain/training/index.ts` barrel.

**Files — tests (new):** `src/domain/training/solve.test.ts`,
`hints.test.ts`, `outcome.test.ts`, `test-support.test.ts`,
`src/domain/puzzle/id.test.ts`.

**Invariants asserted:** per-origin accepted sets (blunder single move, AC #2);
multi-move continuation matching and auto-played replies; terminal accepted
alternatives; solved when user tokens exhausted with trailing opponent token
display-only; wrong moves rejected, counted, remembered, and never in the
played line; no wrong-move limit; UCI exactness (promotion piece, castling,
en-passant); outcome derivation per trigger (clean/hint/wrong/give-up/skip/
discard, AC #4); hint gating (threshold, disabled levels, stop at 4, first-move
only); attempt-row shape/immutability and version/origin copy; unparseable FEN
loads as a typed presentation failure; fixtures walkable without engine/network.

**AC coverage:** #2, #3 (domain mechanics), #4 (outcome derivation; discard
writes nothing), #7 (gating/levels — content rendering in D), #9 (no engine
types imported), #11 (fixtures, incl. the new promotion row).

**Exit check:** `npm run test -- src/domain/training src/domain/puzzle` +
`npm run typecheck`.

---

### Stage B — Persistence: schema v9, attempts repository, cascade, migration

**Aim:** durable, immutable, add-only `puzzleAttempts` rows (schema v9) plus
the game-deletion cascade extension; no orphaned attempt may remain
(ARCHITECTURE §7, game-library §8, puzzle-model ownership).

**Files — new:**

- `src/infrastructure/db/schema/v9.ts` — additive `puzzleAttempts` table
  (new empty table, no `upgrade` backfill):
  `puzzleAttempts: '&[cycleId+puzzleId+presentationIndex], [cycleId+puzzleId], cycleId, puzzleId, trainingSetId'`.
  - Primary natural key `[cycleId + puzzleId + presentationIndex]` = the
    spec's one-row-per-presentation key (a re-presentation in the same cycle
    carries an incremented `presentationIndex` and is a **new** row, never an
    overwrite);
  - `puzzleId` index — the game-deletion cascade and per-puzzle reads;
  - `cycleId` and `[cycleId+puzzleId]` — per-cycle/per-(cycle,puzzle) listing
    for Feature 013 lifecycle/metrics;
  - `trainingSetId` — Feature-013 set-owned cleanup seam.
  - Doc header mirroring `v8.ts`: immutability, ownership, sync exclusion
    (attempts are derived per-game data, never synced standalone — Feature 016
    tombstones only).
- `src/infrastructure/db/schema/v9-migration.test.ts` — hand-built v8 Dexie
  (mirroring `v8-migration.test.ts`), assert v9 opens with pre-v9 rows
  untouched, the v8 table list extended with `puzzleAttempts`, and the new
  table usable through the repository.
- `src/infrastructure/db/attempts-repository.ts` —
  - `PuzzleAttemptsRow` alias (domain `PuzzleAttemptRow` stored verbatim);
  - `DexiePuzzleAttemptsRepository`:
    - `addAttempt(row): Promise<'added' | 'already-present'>` — **first write
      wins on the natural key** (bulkGet then `bulkAdd` the missing row, mirror
      of `puzzlesRepository.addIfAbsent`): rows are immutable once written; a
      corrected outcome is a new presentation (spec Data requirements /
      Immutability). The returned `'already-present'` doubles as the
      write-retry idempotency signal (§10 R-3);
    - `getAttempt(cycleId, puzzleId, presentationIndex)`;
    - `listForCycle(cycleId)`; `listForPuzzle(puzzleId)`;
      `listForCycleAndPuzzle(cycleId, puzzleId)` — Feature 013's
      retry-pass/metrics reads;
    - `deleteForPuzzleIds(puzzleIds)` — the cascade hook (deleteGames calls it
      inside its transaction; also reusable by F013 for set-owned removals).
    - Invariant comment block: no update path for a written row.

**Files — modified:**

- `src/config/app-config.ts` — `PERSISTENCE_SCHEMA_VERSION = 9` + comment line
  ("v9 adds the Feature-012 `puzzleAttempts` table").
- `src/infrastructure/db/database.ts` — register
  `puzzleAttempts!: Table<PuzzleAttemptsRow, [string, string, number]>` (import
  type from the repository), `applyV9Schema(this)`, bump the guard message to
  9.
- `src/infrastructure/db/schema/index.ts` — export `applyV9Schema`.
- `src/infrastructure/db/games-repository.ts` — `deleteGames` (:240-264):
  add `this.database.puzzleAttempts` to the transaction; inside it, first
  collect the deleted games' puzzle rows' ids
  (`puzzles.where('sourceGameId').anyOf(gameIds)`, derive `puzzleIdOf(...)`
  per row), then delete attempts by `puzzleId` (`deleteForPuzzleIds`). The
  engine cache (ADR-018) stays untouched.
- `src/infrastructure/db/database.test.ts` — table-list expectation gains
  `puzzleAttempts`; `db.verno` expectation 9.
- `src/infrastructure/db/game-deletion-cascade.test.ts` — seed attempt rows
  (via `buildAttemptRow` over Stage-A fixtures) for the deleted game's
  puzzles; assert they are removed, another game's attempts survive, and the
  engine cache remains.
- `.opencode/specs/ARCHITECTURE.md` §7 — "currently **v8**" → v9 and the
  version-history line ("v9 adds the Feature-012 `puzzleAttempts` table"),
  same commit as the DB change (mirroring the Feature-011 plan's
  docs-with-DB precedent).

**Invariants (repository-level, unit-tested):** natural-key first-write-wins
(second `addAttempt` of the same key returns `'already-present'` and leaves the
row byte-identical — AC #5); a re-presentation (incremented
`presentationIndex`) adds a distinct row, never an overwrite — AC #5;
per-cycle/per-(cycle,puzzle) listings index-based; cascade removes every
attempt of a deleted game's puzzles and no other game's attempts — AC #6;
no engine/cache types imported.

**AC coverage:** #5 (persistence mechanics), #6 (cascade). Foundational for
#4/#9.

**Exit check:** `npm run test -- src/infrastructure/db` (incl. migration,
database, cascade suites) + `npm run typecheck`.

---

### Stage C — Application service + hosted-session harness

**Aim:** the outcome-write path with retry semantics, plus a deterministic
test-support **hosted-session harness** (a stand-in for the Feature-013 host)
that drives whole presentations end-to-end over fixture rows and a real
(fake-indexeddb-backed) repository.

**Files — new:**

- `src/infrastructure/training/attempts-service.ts` —
  `PuzzleAttemptRecorder` with `record(outcome: { row, context, trigger,
  counters, startedAt, endedAt }): Promise<{ status: 'written' |
  'already-written' }>`: builds the row via the Stage-A `buildAttemptRow` and
  `attemptsRepository.addAttempt`. On `'added'` → `'written'`; on
  `'already-present'` → `'already-written'` (a prior ambiguous write landed —
  the outcome stays visible and the session may advance; spec States/Error
  cases). Throws on a genuine write failure — the caller (UI/host) keeps the
  outcome screen with an inline error and a retry (never silently dropped).
  Constructor-injected repository + `now` for tests.
- `src/infrastructure/training/index.ts` — barrel exporting the recorder, its
  interface, and the attempt-row domain types for Feature 013/014 consumers.
- `src/infrastructure/training/test-support/hosted-session.ts` — the
  **hosted-session harness**: a minimal, test-only host that mirrors the
  Feature-013 host contract over a fixture queue of `PuzzleRow`s
  (next-unanswered presentation in cycle order, per-puzzle
  `SessionPuzzleContext` with an incrementing `presentationIndex` for
  re-presentations, discard-on-exit = skip the write, immediate/end-of-cycle
  retry behavior configurable like 013's `retry-failed` modes). It composes
  the Stage-A solver + Stage-C recorder + attempts repository. Feature-013
  later replaces this harness with its real host without touching F012's
  domain/service.
- `src/infrastructure/training/test-support/index.ts` barrel.

**Files — tests (new):** `src/infrastructure/training/attempts-service.test.ts`
and `src/infrastructure/training/test-support/hosted-session.test.ts`
(fake-indexeddb via the shared setup):

**Invariants asserted (spec Testing — Service/application):** exactly one row
per presentation outcome; discard-on-exit writes nothing and leaves the puzzle
unanswered; a retry-pass re-presentation of the same puzzle in the same cycle
writes an **additional** row with an incremented `presentationIndex` (never an
overwrite); a write-failure keeps the outcome visible/retryable and the session
does not advance past an unwritten row without an explicit confirm-discard;
`already-written` retry resolution; attempt rows are never updated after
writing; no engine/network anywhere; F012 computes no cycle aggregates (the
harness only counts rows — no accuracy/time aggregation).

**AC coverage:** #4 (recording + discard), #5 (one row per outcome; additional
rows on re-presentation), #9 (no aggregates, no engine).

**Exit check:** `npm run test -- src/infrastructure/training` + `npm run
typecheck`.

---

### Stage D — Solving UI: presentation hook, solving screen, outcome + post-solve panels

**Aim:** the Feature-012-owned solving screen and post-solve step, built
standalone against the host contract, fully keyboard/touch/AT-operable and
mobile-responsive, testable with no engine/network/IndexedDB (injected fakes).

**Files — new (components live under `src/components/puzzles/solve/`; the
route/page that mounts them is Feature-013's):**

- `src/hooks/usePuzzleSolve.ts` — presentation controller over the Stage-A
  reducer (domain state is `useReducer` state; pure action functions):
  - per-presentation lifecycle `presenting → solving → outcome → postSolve`
    (spec States; transient, never persisted);
  - wall-clock solving timer from `startedAt` (presentation start) to outcome;
    backgrounded/hidden-tab time counts (spec Edge cases — no per-puzzle
    pause); restart does not reset the clock;
  - controls: user-move (board from/to + optional promotion role, and the text
    path), hint (advance one level per press), restart, skip, give-up /
    show-solution, analyze, continue;
  - at a definite outcome it drives the Stage-C recorder:
    `pending → written`; on failure the outcome stays visible (`retryable`)
    with an inline error + retry, and `continue` is gated until written or the
    user explicitly confirms discarding the outcome (never silently dropped —
    spec Error cases);
  - discard on session leave: unmount/`onExit` mid-presentation records
    nothing (in-memory state only) — the puzzle stays unanswered for the host;
  - injectable recorder + `now` (component tests use a stub; no IndexedDB).
- `src/components/puzzles/solve/SolveScreen.tsx` — the host-facing screen.
  Public props define the **host contract** (exported; Feature 013 supplies):
  `row: PuzzleRow`, `context: SessionPuzzleContext`, `config: SolveHintConfig`,
  `recorder: PuzzleAttemptRecorderLike`, `onExit(outcome | null)` (continue to
  host / discard), `boardSize?`. Renders:
  - interactive shared `Chessboard` (orientation `row.sideToMove`, the user is
    always the mover; promotion via `PromotionDialog`),
  - objective chip via `puzzleObjectiveLabel(row)`; **difficulty never shown**
    while solving (would leak cycle ordering),
  - transport over the presentation's played line (reuse `Navigation`:
    start/previous/next/end) — navigates the current presentation's move line
    only, never between puzzles; read-only viewing; move entry only at the
    decision point (§10 R-10),
  - controls with visible text labels + keyboard/touch: restart, hint, skip,
    give up / show solution; outcome summary (result, solving time, wrong-move
    count, hints used) and analyze/continue on the outcome screen;
  - wrong-move feedback: board marker (red arrow via `uciMoveArrow`) plus a
    non-visual announcement (`aria-live`), never color alone; auto-retry at
    the same decision point (no wrong-move limit);
  - `KeyboardMoveEntry` (§10 R-4): a labelled "Enter a move" field accepting
    SAN (or UCI), validated against the live position with `chessops/san`
    `parseSan`; illegal entries rejected with feedback and **not** counted as
    wrong moves; submitted legal moves go through the same domain evaluation.
- `src/components/puzzles/solve/OutcomePanel.tsx` — outcome summary + inline
  write error/retry + confirm-discard affordance + analyze/continue;
  announced via `aria-live`; focus managed on open and restored on continue.
- `src/components/puzzles/solve/PostSolvePanel.tsx` — the engine-free
  post-solve step (spec "Post-solve analysis"): a **stored, read-only use of
  the shared analysis-board surface** (`AnalysisBoard`, `bar={null}`, ADR-033):
  - board column: shared `Chessboard` replaying the presentation's played line
    (attempt moves marked *matching the verified solution* when solved — never
    an ADR-023 `best` label) with transport over that line; a correctly solved
    puzzle shows no divergence/no eval annotations;
  - side panel (`MoveListPane`): the user's attempt (SAN via `uciPvToSan`)
    alongside the stored verified solution (`bestPv` full SAN; accepted
    alternative first moves where stored; blunder rows the single correct
    move) and the rejected wrong moves ("your move X — not the move that
    achieves the objective");
  - **stored-data annotation only**: at the divergence (a `failed` puzzle), a
    stored ADR-023 glyph/eval-swing line renders **only** when the divergence
    move at the ply is the game's actually-played move with a stored
    `MoveAnalysis` classification for it (in practice the puzzle's source ply +
    `userMovePlayed`) — read via
    `analysesRepository.listForGameAndAnalysis(row.sourceGameId,
    row.analysisId)` and rendered verbatim from stored fields via
    `classificationMeta` helpers; any other divergence shows the
    objective-achieving move from the stored line without glyph/eval; missing
    stored analysis renders without glyphs/eval — absent data is never
    fabricated (spec Error cases);
  - no engine starts, no ADR-018 cache read, no MultiPV configuration,
    nothing recomputed in the view (ADR-033, AC #8);
  - a `failed` outcome opens the step automatically; `solved` opens it on
    **analyze**; `skipped` never offers it (the solution stays unseen);
  - **continue** closes the step and returns to the host with the recorded
    outcome preserved (never lost).
- `src/components/puzzles/solve/KeyboardMoveEntry.tsx` — labelled input +
  submit + inline rejection/announcement.
- `src/components/puzzles/solve/index.ts` — barrel exporting `SolveScreen`,
  `OutcomePanel`, `PostSolvePanel`, `usePuzzleSolve`, and the host-contract
  types (Feature-013's import seam).
- CSS modules per component (desktop three-zone; stacks board → controls →
  move list/analysis on tablet/mobile; light/dark via existing tokens).

**Files — tests (new):** `SolveScreen.test.tsx`, `PostSolvePanel.test.tsx`,
`usePuzzleSolve.test.ts`, `KeyboardMoveEntry.test.tsx` — fixture rows only,
stub recorder, no engine/network/IndexedDB (spec Testing — Component):
presentation start (board at `startingFen`, orientation, objective label per
origin, zero counters); correct/wrong move feedback incl. wrong move returning
to the decision point; multi-move + terminal-alternative flows; promotion via
dialog and via text entry; hints text/highlights per level and gating;
restart clears line + hint content but keeps counters/clock; skip/give-up/
transport; outcome summary; post-solve contents incl. the stored-only
divergence annotation (glyph shown only with a stored `MoveAnalysis` record;
absent otherwise) and continue to the (stub) host with the outcome preserved;
keyboard/AT: every control is a real labelled control, announcements
(`aria-live`) for wrong-move verdict/hint/outcome, focus management,
pointer-free move entry works end-to-end (AC #10); mobile stacking.

**AC coverage:** #1 (presentation, mouse/touch), #2/#3 (feedback in UI),
#4 (outcome screens/analyze-on-failure), #7 (hints render exactly PRODUCT §10
content), #8 (post-solve read-only, stored-only annotations, continue keeps
outcome), #9 (no engine/regeneration anywhere in the UI), #10 (keyboard/AT).

**Exit check:** `npm run test -- src/components/puzzles/solve
src/hooks/usePuzzleSolve.test.ts` + `npm run typecheck` + `npm run lint`.

---

### Stage E — Integration & hand-off seams (Library no-op; F013 host seam; dev smoke)

**Aim:** close the feature's integration surface per the spec without adding
scope: prove the Game Library needs no change, expose the Feature-013 host
seam, and confirm nothing else regresses.

**Files — modified (deliberate no-ops, documented):**

- **Game Library** — no code change (spec "Game Library integration"):
  `src/domain/gameLibrary/rowView.ts` already declares
  `masteredPuzzleCount?` (`:128`) and the `puzzles` capability (`:43`) as
  read-model fields; F012 adds no row action/insight of its own, never
  computes the mastered-from-game aggregate (that is Feature 013/014 over the
  attempt rows this feature writes), and Feature-011's per-game puzzle view
  stays read-only. Add a short doc comment on the rowView field pointing at
  the attempt-row source (one-line provenance note only).
- **Feature-013 host seam** — the exports in
  `src/components/puzzles/solve/index.ts` (Stage D) and
  `src/infrastructure/training/index.ts` (Stage C) plus the domain barrel are
  the consumed surface; add a module doc header on each barrel stating the
  012→013 boundary (013 hosts the screen in its own route/page, supplies the
  queue/config/`SessionPuzzleContext` incl. `presentationIndex`, decides
  retry-failed behavior and cycle completion from the recorded rows, and
  derives all cycle aggregates). No routes, no nav changes
  (`src/pages/PuzzlesPage.tsx` placeholder and `/puzzles` stay Feature-013's).
- Regression proof: full unit/component suite + a dev smoke that the existing
  app boots cleanly (F012's screen has no route until 013; the solve screen's
  behaviour is covered by the Stage-D component tests against the stub host).
  Optional manual visual smoke of the solve screen can be done by mounting
  `SolveScreen` on a scratch fixture host under the dev playground; this is a
  dev-only convenience and is not required for the gate.

**Invariants:** no Library capability/action/insight added; no route/nav
change; no `puzzles`-table or summary-row change; the only new persisted data
is `puzzleAttempts`; attempt rows are never synced as standalone values.

**AC coverage:** #6 (deletion story complete, Library untouched), #9
(boundaries), plus the 013-handoff seam.

**Exit check:** `npm run test` (full suite regression) + `npm run dev` smoke
(no console errors) — visual solver check optional via the scratch host.

---

### Stage F — Test closure + deterministic-fixture consolidation

Stages A–E each carry their focused tests. Stage F closes the gaps the spec's
Testing requirements list:

- **Domain** — consolidate every acceptance-criteria property incl. promotion/
  castling/en-passant UCI exactness across both origins, multi-move line
  matching, terminal accepted alternatives, hint gating, outcome derivation
  (all five triggers + discard), fixture walkability (all F011 kinds + the new
  promotion/edge rows).
- **Repository** — natural-key first-write-wins, per-cycle/per-(cycle,puzzle)/
  per-puzzle listing, immutability (re-add no-op; row bytes unchanged),
  migration (v8→v9), cascade (game → puzzles → attempts; other games'
  attempts and the engine cache survive).
- **Service/harness** — one row per outcome; discard writes nothing; retry
  pass adds rows with incremented presentationIndex; write-failure retry keeps
  the outcome visible; `already-written` resolution; no aggregates computed.
- **Component** — solving screen + post-solve over fixture rows with a stub
  recorder (both origins, multi-move, accepted alternatives, promotion),
  stored-only divergence annotations, keyboard/AT behaviour (announcements,
  focus, pointer-free entry), mobile layout.
- **End-to-end** — **not part of Feature 012**: the full
  set → cycle → solve → attempt → cycle-completion flow requires the
  Feature-013 host and lands with that feature (spec Testing — End-to-end and
  `012-puzzle-training.md` "Testing requirements"). F012's own slice is
  covered by the harness above. No committed-engine e2e is added here.

**AC coverage:** all eleven, mapped in §11.

**Exit check:** `npm run test` (full unit/component suite).

---

### Stage G — Docs, version notes, full gate

**Files — modified (docs only unless already done in B):**

- `.opencode/specs/ARCHITECTURE.md` §7 — already updated to v9 in Stage B;
  verify the deletion-cascade sentence and entity list already mention puzzle
  attempts (they do — §7 data-ownership text) and adjust wording only if the
  v9 edit left an inconsistency.
- `.opencode/specs/features/012-puzzle-training.md` — **no change**: the
  trailing `Open questions` stay open for the owner (§10). If implementation
  surfaces a doc-vs-code conflict not captured here, stop and report it
  (AGENTS source-of-truth rule).
- `src/config/app-config.ts` comment + DB guard already updated in Stage B.
- **Version note:** Feature-012 introduces no generator/detection version
  bump (`PUZZLE_GENERATOR_VERSION` stays 2, `DETECTION_VERSION` untouched).
  Each attempt row copies the row's `puzzleGeneratorVersion` and normalized
  `origin` at write time so rows stay interpretable after generator advances
  (ARCHITECTURE §9). Schema v9 is additive; no data migration.

**Full gate:** `npm run lint`, `npm run typecheck`, `npm run format:check`,
`npm run test`, `npm run build`, `npm run dev` smoke (no console errors),
`npm run test:browser` when Chromium is available (existing specs only — the
012/013 e2e lands with Feature 013), `npm audit`.

---

## 5. Domain/data changes (consolidated)

- **New entity — `PuzzleAttempt`** (`domain/tactical-training.md`,
  ARCHITECTURE §7): one immutable row per puzzle **presentation** in a cycle;
  natural key `[cycleId, puzzleId, presentationIndex]` (spec Data
  requirements; per-presentation granularity = the spec baseline, §10 OQ-1);
  columns `puzzleId`, `trainingSetId`, `cycleId`, `presentationIndex`,
  `startedAt`, `endedAt`, `result`, `solvingTimeMs`, `wrongMoveCount`,
  `hintCount`, `highestHintLevel`, `solved`, plus the copied
  `puzzleGeneratorVersion`/normalized `origin`. Never updated once written; a
  corrected outcome is a new presentation (add-only).
- **`puzzleId`** — canonical derived string `puzzleIdOf(sourceGameId,
  sourcePly)` (`<game>:<ply>`) in the puzzle domain; the F011 natural key
  `[sourceGameId + sourcePly]` is unchanged and no `puzzles`-table field is
  added.
- **Versioning** — attempt rows copy the puzzle's generator version + origin
  at write time (ARCHITECTURE §9); no version constant is bumped by F012.
- **Ownership/deletion** — attempts are game-owned through their puzzle:
  `deleteGames` removes the game's puzzles and transitively their attempt rows
  (transactional, `puzzleId` index); set/cycle-owned removals (Feature 013)
  ride the same `trainingSetId`/`cycleId` indexes. Engine cache untouched.
- **Sync** — attempt rows are derived per-game data, never synced standalone
  (Feature 016 tombstones only) — no code, documented on the schema header.

## 6. UI changes

No new routes, nav entries, Library row actions/insights, or changes to the
Feature-011 per-game puzzle view (F013 owns the entry surface). Feature 012
ships: the solving screen components (`SolveScreen`, `OutcomePanel`,
`PostSolvePanel`, `KeyboardMoveEntry`, `usePuzzleSolve`) with the shared
Chessboard (interactive solving board; promotion dialog), a move-line
transport, hint text/board-highlight rendering (PRODUCT §10 content only),
outcome summaries, and the stored-only post-solve step on the shared
analysis-board surface. Light/dark via existing tokens; mobile stacks
board → controls → move list/analysis; every action is a labelled control
reachable by keyboard and touch; wrong-move verdicts/hints/outcomes are
announced (`aria-live`); focus is managed on presentation start/end and
post-solve open/close; a pointer-free move-entry path exists (SAN/UCI field).

## 7. Infrastructure changes

Schema v9 (`puzzleAttempts` table + indexes); attempts repository; deleteGames
cascade extension; attempt recorder service + test-support hosted-session
harness; database table registration + `PERSISTENCE_SCHEMA_VERSION` bump +
guard; migration test. No engine, no worker, no ADR-018 cache, no sync, no
new dependency.

## 8. Tests

Spread across the stages (A–F): pure solving/hint/outcome/fixture tests;
migration + repository tests (natural-key idempotence, immutability, cascade);
service/harness tests (exactly one row per outcome, discard writes nothing,
re-presentation increments, write-failure retry); component tests with stub
recorder and fixture rows (no engine/network/IndexedDB) covering presentation,
feedback, hints, transport, outcomes, post-solve annotations, keyboard/AT and
mobile. The committed-engine end-to-end flow lands with Feature 013 (its host
is required by the spec).

## 9. Migration considerations

- **Schema v9** is purely additive (new empty `puzzleAttempts` table); v1–v8
  rows untouched (migration test mirrors `v8-migration.test.ts`).
- **Existing puzzles/summaries/candidates** are untouched; attempt rows only
  exist after F012 writes them.
- **Legacy pre-v2 puzzle rows** (no `origin`) train normally as tactical rows:
  the accepted set is `{bestMove}` when `acceptedFirstMoves` is absent, and the
  attempt copy normalizes `origin` to `'tactical'`.
- **F011 rows store no alternative continuations** (see §10 R-1) — accepted
  alternatives are terminal by data shape; no migration can change that and
  none is attempted.
- **Deletion of a game** with existing attempt rows (post-F012) cascades
  transactionally; no orphaned attempt may remain.

## 10. Risks & open questions

**Owner decisions (product rule — flag, do not silently choose):**

- **OQ-1 — Attempt-row granularity & cycle aggregates.** The spec adopts one
  row per presentation with natural key `[cycleId, puzzleId,
  presentationIndex]`, while `domain/tactical-training.md` is ambiguous under
  in-cycle retry passes (single final-outcome row per (cycle, puzzle) vs. one
  row per retry step). **Recommendation: keep the spec's per-presentation
  baseline** (this plan implements it — Stage A/B/C), because
  `tactical-training.md` Lifecycle states "Each retry step is recorded so that
  'number of attempts' and 'required retries' are measurable", which
  per-presentation rows satisfy exactly; Feature-013's aggregate formulas
  (first-try-accuracy denominator, "puzzles completed", retry-pass handling)
  are then defined over rows where `presentationIndex = 1` is the first
  presentation. If the owner later chooses a single final-outcome row per
  (cycle, puzzle), the write contract changes (addAttempt semantics, repo
  listing, and F013's retry-pass derivation) — that decision must land before
  Feature 013's aggregate formulas.
- **OQ-2 — `solvedWithHelp` covers wrong-move solves.** The spec's Outcomes
  table and `domain/tactical-training.md` both define a solve after a wrong
  move (no hint) as `solvedWithHelp`. **Recommendation: keep the merged
  bucket**; the row already records `hintCount`/`highestHintLevel`/`wrongMoveCount`,
  so Features 013/014 can split "hint solves" from "error-then-clean solves"
  post hoc without a distinct result value. No new bucket in V1.
- **OQ-3 — Post-solve depth.** The engine-free, stored-data-only post-solve
  step cannot explain *why* an arbitrary novel wrong move loses. This plan
  (and Stage D's PostSolvePanel) implements exactly the stored-only version.
  **Recommendation: confirm and defer** any true per-divergence engine
  evaluation to future scope built on the Feature-006 live mode (engine runs,
  labelled live), per the spec.
- **OQ-4 — Presentation-scoped defaults.** Restart semantics (clears the
  line + hint content; keeps counters/clock/attempt), wall-clock timing across
  backgrounded tabs (counts), hint-button granularity (one level per press)
  and "analyze opens automatically on failure". **Recommendation: adopt the
  four spec V1 defaults as implemented** (Stage A/D). They are revisable
  product defaults (default-value changes need no ADR per
  `tactical-training.md`), so keep them in small, clearly-marked constants.

**Design decisions with recommended resolutions (implementation-level; raised
here because the spec/data delegate them):**

- **R-1 — Accepted-alternative continuation gap (spec ↔ data conflict).** The
  spec's "Advancing the line" allows an accepted alternative "whose
  continuation is stored", but the shipped Feature-011 `PuzzleRow` stores only
  first-move tokens (`types.ts:94`; assembly `assemble.ts:163-165`); **no
  per-alternative continuation exists anywhere in V1 data**. **Resolution:**
  the solver treats every accepted alternative as terminal (solved immediately
  on that first move — the spec's documented terminal-alternative contract and
  AC #3); the code path that reads a continuation, if present, is defensive
  only (data-shaped for a future row extension) and is never exercised by V1
  rows. Tests pin the terminal path. No `puzzles`-table change is made.
- **R-2 — `puzzleId` representation.** Attempt/set references need a stable
  id string (the F011 plan's R-5 deferred one). **Resolution:** canonical
  `puzzleIdOf(sourceGameId, sourcePly) = "<gameId>:<sourcePly>"` in
  `src/domain/puzzle/id.ts`, exported for F013 membership and F014 stats;
  attempts never store `sourceGameId`/`sourcePly` separately (spec column list
  has `puzzleId` only) — the `puzzles` natural key remains the authority.
- **R-3 — Attempt-write retry/idempotency.** A retried outcome write after an
  ambiguous failure must not double-write or mutate. **Resolution:** the repo's
  `addAttempt` is first-write-wins on the natural key; the recorder maps
  `'added' → 'written'` and `'already-present' → 'already-written'` (the first
  write landed; outcome visible, session may advance). Genuine failures throw;
  the outcome screen stays with an inline error + retry until written or the
  user explicitly confirms discarding the outcome (never silently dropped).
- **R-4 — Pointer-free move entry (AC #10).** The app has no keyboard
  piece-movement precedent (arrow keys must not move pieces, ADR-033/F006).
  **Resolution:** a labelled "Enter a move" field on the solving screen that
  accepts SAN (or UCI) validated against the live position with
  `chessops/san` `parseSan` (already a dependency); illegal text entries are
  rejected with feedback and are **not** counted as wrong moves; legal entries
  feed the same domain evaluation as board moves. This satisfies the
  pointer-free-possible essential-action requirement without new board
  machinery.
- **R-5 — Attempt-row terminology.** The spec column "wrong-move count (the
  domain's 'number of attempts')" and `tactical-training.md`'s per-attempt
  "number of attempts (wrong moves / retries within this puzzle)" are the same
  field. **Resolution:** the domain field is `wrongMoveCount` with a doc
  comment stating the mapping; F013 derives cycle "attempts/retries" counts
  from these rows (its own concern).
- **R-6 — Discard-on-exit.** Mid-presentation session end must write nothing
  and never show the post-solve solution. **Resolution:** presentation state
  lives only in `usePuzzleSolve` memory; unmount/`onExit(null)` discards it;
  the recorder is only reached at a definite outcome. In-memory wrong-move and
  hint content vanish with the state (never persisted beyond the attempt
  counters).
- **R-7 — Schema-milestone sequencing.** The spec calls v9 the "joint
  Feature-012/013 schema milestone", but 012 ships first. **Resolution:**
  v9 = the `puzzleAttempts` table alone with `cycleId`/`trainingSetId`/
  `presentationIndex` columns and indexes already in place; Feature 013 later
  adds `trainingSets`/`trainingCycles` as schema v10. The joint-shape language
  is satisfied because the attempt row shape 013's lifecycle builds on is fixed
  here.
- **R-8 — Origin copy normalization.** Pre-v2 rows lack `origin` (absent =
  tactical). **Resolution:** `buildAttemptRow` copies `origin: row.origin ??
  'tactical'` so attempt rows are unambiguous for later stats without touching
  the immutable puzzle row.
- **R-9 — Clock.** `startedAt` = presentation start (row handed to the screen);
  solving time = wall-clock to outcome (`Date.now`); backgrounded time counts
  (V1 default); restart does not reset the clock. `now` is injectable in the
  domain/recorder for deterministic tests.
- **R-10 — Transport vs. move entry.** Transport start/previous/next/end
  navigates the current presentation's played line for viewing only; move
  entry is accepted only at the decision point (end of the line). Playing from
  a viewed earlier ply is not possible (matches "board transport over the moves
  made" + retry-at-decision-point semantics).
- **R-11 — Feature-013 e2e ownership.** The spec's committed-engine e2e needs
  the F013 host and "lands with that feature"; F012 therefore ships no
  Playwright spec (its own slice is covered by the hosted-session harness +
  component tests). Stage G's `test:browser` runs the existing specs.

**Residual risks:** the spec is large and the UI stage (D) is the widest —
keep the solve screen's host-facing prop surface small and stable so F013 can
consume it unchanged; treat every OQ/R above as an owner checkpoint before
Feature 013's aggregate formulas are written; no data migration is expected
(v9 additive, rows immutable).

## 11. Acceptance criteria (spec #1–11 → stage)

| # | Criterion | Covered in |
|---|-----------|------------|
| 1 | Fixture row of either origin starts a fresh presentation (board at `startingFen`, oriented to user's color, objective label per origin, zero counters); mouse + touch solving | Stage A fixtures + Stage D (+F tests) |
| 2 | Blunder row accepts exactly `bestMove`; any other legal move incorrect, does not advance | Stage A (domain) + Stage D (UI feedback) |
| 3 | Tactical accepted set `{bestMove} ∪ acceptedFirstMoves`; auto-played opponent replies; branch user moves in order; completion on user-token exhaustion; terminal accepted alternative | Stage A (+F tests); terminal path per R-1 |
| 4 | Clean solve → `solvedFirstTry`; solve after hint/wrong move → `solvedWithHelp`; give-up → `failed`; skip → `skipped`; leave mid-presentation → nothing written | Stage A (outcome) + Stage C (recorder/harness) + Stage D (outcome screen) |
| 5 | Each outcome writes exactly one immutable `puzzleAttempts` row keyed `[cycleId, puzzleId, presentationIndex]` with full column set; re-presentation adds a row, never overwrites | Stage B (repo) + Stage C (harness) |
| 6 | Deleting the source game deletes its puzzles and attempt rows; no orphans | Stage B (cascade) |
| 7 | Hints reveal exactly PRODUCT §10 level content, respect availability/threshold, stop at level 4, first-move only, never fail the puzzle | Stage A (gating) + Stage D (rendering) |
| 8 | Post-solve read-only over stored data: no engine/cache/MultiPV; solved shows attempt matching the verified solution (no invented glyphs); failed highlights divergence with stored annotation only where a stored `MoveAnalysis` exists; continue returns to host with outcome preserved | Stage D (PostSolvePanel) + Stage E (seam) |
| 9 | No cycle aggregates, no engine, no puzzle regeneration/re-derivation anywhere in F012 | Stages A/C/D invariants + F tests (no engine imports) |
| 10 | Solving screen keyboard-operable end-to-end incl. pointer-free move entry; outcomes announced; no color-only signal | Stage D |
| 11 | Fixtures (both origins, multi-move, accepted alternatives, promotion) deterministic; no engine/network/IndexedDB for domain/component tests | Stage A (+F closure) |

## 12. Verification commands

Narrow-first per stage, full gate at the end (AGENTS.md Execution policy):

```text
# Stage A
npm run test -- src/domain/training src/domain/puzzle
# Stage B
npm run test -- src/infrastructure/db
# Stage C
npm run test -- src/infrastructure/training
# Stage D
npm run test -- src/components/puzzles/solve src/hooks/usePuzzleSolve.test.ts
# Stage E
npm run test          # full suite regression + Library untouched
# Stage F
npm run test          # full unit/component suite (all AC properties)
# Full gate (Stage G)
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev            # smoke: existing app boots with no console errors (the
                       # solving screen has no route until Feature 013; its
                       # behaviour is covered by the Stage-D component tests)
npm run test:browser   # existing specs when Chromium is available (the
                       # set→cycle→solve e2e lands with Feature 013)
npm audit
```
