# Plan — Tactical detection: proven-algorithm recall, scan progress reporting, engine-time control

Follow-up to `.opencode/plans/012-…` (scan lifecycle) and the Feature-010/011
milestone. Addresses the owner report: tactics finding "takes a lot of time",
gives **no progress reporting**, and **does not catch many of the tactics**
the owner expects. No new runtime dependency is required by the recommended
option (Q1-A); option Q1-B/C are also dependency-free.

Depends on shipped Features 001–010 and plans 011–012 (both now committed).

---

## 0. Findings — how detection works today (verified in code)

### 0.1 We re-search candidate positions with Stockfish — but not the whole game

After a game's analysis is persisted `completed`, the Feature-010 pass runs
**detached** (`analysisService.ts` `runDetection`, plan-012/R3) and:

1. **Stage 1** (`src/domain/tactics/stage1.ts`) is pure and engine-free: it
   scans **only the user's plies** and emits a candidate when the user's
   played move was **not** the engine best move **and** its win% loss
   crossed the inaccuracy band (`wpLoss ≥ 5`, `WPLOSS_INACCURACY`).
2. **Stage 2** (`tacticalDetectionService.ts` `verifyCandidateWithEngine`)
   **re-searches each candidate's starting FEN** with Stockfish at the
   `tactical` profile (depth 22, **MultiPV 5**, WDL, 128 MB —
   `engineProfiles.ts`), behind the ADR-018 position cache, then runs the
   pure `verifyCandidate` guards (objective within ≤ 8 plies, difficulty
   ≥ 15, no non-forcing alternative, WDL consistency).
3. The committed plan-012 **fast path** (WP-C) skips the engine for
   candidates whose stored analysis is already a decisive complete mate
   line; everything else is re-searched.

So: per *candidate* we run a fresh tactical engine search; we never re-run
the whole game at the analysis profile. Long scans happen when a game has
several error-plies (each a candidate) and/or the moves in question are not
decisive-mate fast-path-able.

### 0.2 Why not do it during the first analysis

- **Different engine needs.** The bulk run is **single-PV** at the
  fast/normal/deep profile (no WDL on `fast`). Verification needs **deeper
  MultiPV 5 + WDL** on the candidate position to run the unicity /
  alternative-move / difficulty / WDL-consistency guards. Running that on
  *every* position (not just candidates) would cost many times more than the
  analysis itself and would slow every game, not just tactical ones.
- **Candidates only exist after classification.** Stage 1 needs the
  persisted per-ply `evalBefore/evalAfter` and `bestMove`; those are
  products of the finished analysis.
- **Derived, resumable, cancellable data.** Detection is Feature 010 (not
  008): it is idempotent, resumable, backfillable, "resume-scan" capable
  (plan-012) and must never block the analysis queue (R3) or the UI.
- **Cache.** ADR-018 keys by profile, so a later re-scan reuses earlier
  tactical-profile results.

### 0.3 Why there is no progress reporting

The detection summary persists a pass **state** (`absent → queued →
inProgress → completed | failed`) and a final `missedTacticCount`. Plan-012
added an engine-activity banner/Review scan bar, but the pass **never writes
a numeric counter** (e.g. "verifying candidate 3 of 7"), so there is nothing
to draw a progress bar from. This is an implementation gap, not a design
limit: Stage-1 already computes the full candidate set up front, so a
`verified/total` counter is cheap to persist and surface.

### 0.4 Why detection misses tactics the owner expects (low recall)

Stage 1 only fires when the user's move was a **≥ 5 win% mistake**. It does
**not** fire when:

- a strong tactic existed on the user's turn but the played move was quiet
  and only slightly suboptimal (wpLoss 0–5) — the biggest blind spot;
- the user **missed a mate / a forced win from an already-winning position**
  (Lichess deliberately excludes these from its public DB as trivial, but
  for *personal* training they are exactly "I missed the tactic");
- the opponent's previous move **conceded** a tactic (a big eval swing on
  the opponent's ply) and the user then failed to punish it with a quiet
  non-best move;
- tactics longer than 8 plies or on the opponent's side are never mined.

---

## 1. Research — proven open-source algorithms (references)

Surveyed with citations (see §0 of the research notes in the plan commit):

- **lichess-puzzler generator** (`ornicar/lichess-puzzler`, AGPL-3.0 —
  lichess's current mining front-end): operates on an **eval-annotated game
  dump**; for **every ply** (both sides) it reads the eval swing *caused by
  the move just played* (`win_chances(score) > win_chances(prev) + 0.6`,
  mate threshold ≈ Mate(15), skip already-up-material / already->3-pawns
  positions), then verifies only those positions with a deeper MultiPV-2
  search and requires the winning move to beat the second move by **≥ 0.7
  win-chance** (unicity); cook-mate/advantage recurse down the best line.
  No on-demand per-game generator; "puzzles from my games" is a DB lookup.
- **Chess-Tactic-Finder** (`JakimPL/Chess-Tactic-Finder`, no license —
  reference only, do not copy): after every move runs a tactic search for
  the side to move (both colors), building a solver/defender variation tree
  (solver node: best move beats 2nd by ≥ 150 cp or shortest-mate unicity;
  defender: replies within 30 cp), outcome = mate/material ≥ 3/draw. High
  recall, but **one MultiPV-5 engine search per ply** — far too expensive
  for a local WASM engine per game.
- **chess.com** (public Q&A): the same industrial criteria — one good move
  per player move, opponent's move not terrible, winning end position.
- **pgn-tactics-generator** (`vitogit`, MIT): cheap `investigate()` swing
  prefilter at depth 8 then ambiguous()-rejection (best move clearly
  winning, no near-equal second move).

**Key takeaway:** lichess scans **both sides** and keys on the **position**
(was there a unique winning tactic after the opponent's move conceded a
swing?), not on "the user made a mistake". That is the recall fix.

---

## 2. Objective

1. Detection catches the tactics the owner expects: candidates keyed on
   **positions where a tactic exists on the user's turn** (incl. quiet
   misses and missed mates/forced wins), not only on user ≥ 5 win% errors,
   using the lichess-puzzler candidate model + the existing Stage-2
   verification (chosen algorithm, Q1-A).
2. The tactics pass reports **numeric progress** (candidates done/total +
   phase) surfaced as a **progress bar in a distinct colour** in the Library
   row/banner and the Review scan bar — same shape as the analysis progress
   bar, visually different.
3. Engine time stays bounded: candidate cap per game (swing-priority),
   node/time budget over raw depth where practical, ADR-018 reuse, and
   re-scans stay resumable/cancellable (plan-012).
4. Specs/ADR-026/research updated; deterministic fixtures + unit/component/
   e2e tests; commits per work package.

## 3. Scope

### In scope
- Stage-1 candidate-generation v2 (position-centric, per Q1-A) + fixture
  tests incl. the previously-missed "quiet miss" and "missed mate" cases.
- Verification: explicit unicity (best-over-second ≥ ~0.7 win-chance) gate
  addition; keep existing guards; difficulty/objective unchanged.
- Scan progress: summary gains an additive `progress`/counter (verified
  candidates + total + phase), service writes it, UI progress bar in a
  distinct colour (Library row/banner + Review scan bar), a11y text.
- Engine-time controls: per-game candidate cap, priority order, budget knobs
  (documented constants; DETECTION_VERSION bump only via ADR-026 process).
- Spec/ADR updates (Feature 010, ADR-026, research `tactical-detection.md`,
  domain/game-library.md surfacing, Feature 008 if progress plumbing
  touches it), tests, commits.

### Out of scope
- Mining the opponent's tactics as *user* puzzles (Q2); adding a second
  engine; cloud/fishnet; multi-worker engines; changing ADR-023/024/025 math.
- Making the *analysis* pass run tactical searches (the two passes stay
  separate — §0.2).

## 4. Open product questions (confirm before the gated phases)

### Q1 — Which algorithm for candidate generation? (gates WP-A)
- **Option A (recommended) — lichess-puzzler position-centric model on the
  user's turns.** For each user ply emit a candidate when ANY of:
  1. *Opponent-conceded swing*: the opponent's last move conceded ≥ ~0.25
     win-chance to the user (mover-normalized from the opponent ply's
     eval-after to the user ply's eval-before); the tactic is "there".
  2. *Missed decisive/mate*: the user's position before is already winning
     for the user (`cp ≥ +300` or a user forced-mate within ~8 plies) and
     the played move ≠ best. (Lichess rejects these for its public DB as
     trivial; personal training wants them.)
  3. *Quiet/small-loss miss*: played move ≠ best with win% loss in
     `[1, 5)` whose best first move is check/capture or rule-1 fired.
  4. *Today's rule (kept)*: played move ≠ best and `wpLoss ≥ 5`.
  Stage-2 verification unchanged + explicit unicity gate. Recall fix with a
  near-identical engine-cost profile (deep searches only at candidates).
- **Option B — Chess-Tactic-Finder forcing-minimax scan (both sides, every
  ply).** Highest raw recall (incl. defensive only-moves and tactics that
  needed no preceding error) but 30–80 engine runs/game in WASM; needs new
  tree code; only sensible behind the same Stage-1 prefilter (in which case
  it degrades into Option A + extra work).
- **Option C — Minimal relaxation.** Keep user-error gating; lower the
  inaccuracy floor to `wpLoss ≥ 1` and add a missed-mate override only.
  Smallest change; still misses "my move was fine but I missed the win"
  unless the opponent's error was itself a big single-ply blunder.

**Recommended: Q1 = Option A.**

### Q2 — Should the user's own *successful* tactics (found, not missed) also become puzzles?
V1 semantics are "missed tactics" from the user's mistakes. Finding a tactic
the user actually *played* well (their best move was a tactic) is a great
training puzzle from their own wins. Options: (a) V1 stays missed-only;
(b) add "found" puzzles behind a toggle/filter. Recommended: (a) for the
detection pass + summary now; (b) is a Feature-011/puzzle-source decision —
record as a follow-up, do not build in this plan.

### Q3 — Candidate cap & order (engine-time)
Recommended: cap per game (e.g. 12), priority by swing size, node/time
budget override on the tactical search (ADR-026 constant change) rather than
raw depth for determinism/latency. Confirm the cap value.

### Q4 — Progress semantics & colour
Recommended: reuse the analysis progress-bar shape but a **distinct colour**
(tactics = magenta `#c2185b` family, matching the missed-tactic marker) and
label ("Verifying tactic 3/7…" or "Scanning tactics…"). Per-row and Review
scan bar only while the pass is genuinely running (plan-012 live registry);
never claim progress for an interrupted pass. Confirm the colour choice.

---

## 5. Work packages (dependency order: W1 → W2 → W3 → W4 → W5; docs in each)

### W1 — Stage-1 recall (Q1-A candidate rules)
- `src/domain/tactics/stage1.ts`: emit candidates per §Q1-A rules 1–4
  (mover-normalized swing from the opponent ply's record; `evalBefore`
  decisive/mate check; relaxed `[1,5)` rule gated on forcing first move or
  swing). Pure + deterministic; caps candidates per game (Q3).
- `CANDIDATE_GENERATION_VERSION` → 2 (types.ts) via the documented process.
- Fixtures: extend `stage1.test.ts` — the previously-missed cases ("quiet
  miss keeps eval flat", "missed mate from already-winning", "opponent
  blunder + quiet reply") now yield candidates; old-behaviour tests updated.

### W2 — Verification unicity gate
- `verify.ts`: add the lichess-style unicity check on the MultiPV top two
  (best-over-second ≥ ~0.7 win-chance) while keeping the existing
  alternative/objective/difficulty/WDL guards; applied only to the
  win/decisive objectives (mate paths keep the forcing walk). Guard order +
  rejection reason documented; tests for boundary (near-equal second move ⇒
  reject) and regression.

### W3 — Scan progress reporting (colour + counter)
- Domain: summary model gains additive `scanProgress { done, total }` +
  keep state; `summarize`/derivation defaults when absent (older rows).
  Repositories: additive field, no schema bump (or additive v8 documenting
  it) — decision at implementation.
- Service (`tacticalDetectionService`): persist total after Stage 1 and
  increment done as each candidate settles (verified/rejected/failed
  counted), including resumed passes (persist from stored verified rows).
- UI: Library row/banner progress bar in the distinct colour + label and the
  Review scan bar show `done/total`; a11y text spells the numbers; detection
  state unchanged (queued/inProgress/…). Reuse `useLibraryAnalysis`-style
  poll only while live (plan-012).
- Tests: service writes monotonically increasing progress; component shows
  the bar with the tactics colour and %; resumed pass restores totals.

### W4 — Engine-time controls (Q3)
- Node/time budget override for tactical verification (documented constant,
  ADR-026 change + DETECTION_VERSION bump if guards change), candidate cap
  enforcement, order by swing. Measure on the e2e fixture game.

### W5 — Docs/specs + e2e
- Rewrite `features/010-tactical-detection.md` candidate rules (position-
  centric, lichess-puzzler provenance + citation, missed-mate/mate/quiet
  rules), `ADR-026` Stage-1 revision note, research `tactical-detection.md`
  §candidate-selection rewrite, domain/game-library + Feature 008 surfacing
  of scan progress; note the algorithm sources & licence posture (AGPL /
  no-license repos are references only — no code copied; method + thresholds
  ported).
- e2e (engine fixture): a game where the user misses a **quiet** tactic /
  a mate from an already-winning position now surfaces a missed tactic in
  row + Review; scan progress bar visible while running.

## 6. Files to create/modify (summary)

Create: this plan.
Modify (main): `domain/tactics/stage1.ts(+test)`, `types.ts`,
`verify.ts(+test)`, `domain/analysis/summaryDerivation.ts(+test)` (progress
in summary), `infrastructure/tactics/tacticalDetectionService.ts(+test)`,
`infrastructure/db/summaries-repository.ts` (+ optional schema v8),
`components/games/library/GameLibrary.tsx(+css,+test)`,
`hooks/useGameReview.ts`, `pages/GameReviewPage.tsx(+css,+test)`, plus the
spec/ADR/research files in W5 and `tests/e2e/*.spec.ts`.

## 7. Domain/data changes
- `CANDIDATE_GENERATION_VERSION` 1 → 2 (candidate rule change).
- Detection summary: additive `scanProgress { done, total }` + phase; absent
  for older rows (defaults); no table rewrite.
- `MoveAnalysis` unchanged; opponent-ply records already persisted (Stage-1
  needs them for rule 1 — no schema change).
- No new dependency; DETECTION_VERSION bumped only if Stage-2 guards change
  (W2/W4) through the ADR-026 process.

## 8. Verification commands
Narrowest-first per WP, then the AGENTS gate: `npx vitest run src/domain/tactics
src/infrastructure/tactics src/domain/analysis src/components/games/library
src/pages/GameReviewPage*`, then `npm run lint/typecheck/format:check/test/build`,
`npm run test:browser -- game-analysis-review`, `npm audit`.

## 9. Commit plan
1. `feat(010): position-centric candidate generation (lichess-puzzler rules) — candidateGenerationVersion 2`
2. `feat(010): verification unicity gate (best-over-second win-chance)`
3. `feat(010/008): detection scan progress (counter + distinct-colour progress bar; Library + Review)`
4. `perf(010): candidate cap + node budget + swing ordering for tactical scans`
5. `docs(010/026+research): spec/ADR updates for the recall & progress milestone`
6. `test(010): engine e2e — quiet-miss/missed-mate fixture surfaces; scan progress bar`

Spec updates land within each WP where practical; commit 5 catches stragglers.

## 10. Risks
- Rule thresholds are engine-depth noisy → validate on fixture games; keep
  the existing quality guards (difficulty/objective) so recall gains never
  flood low-quality puzzles.
- More candidates ⇒ longer scans → mitigated by W4 cap/budget + resumable/
  cancellable pass (plan-012) + visible progress (W3).
- AGPL / no-license references: port methods/thresholds only (facts are not
  copied code); record this in the docs (W5) and do not vendor any of it.
- Progress writes add IndexedDB writes per candidate → batch/debounce if
  needed; additive fields keep old rows readable.
