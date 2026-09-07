# Plan 014 — Handoff: "tactics scan still misses my b4/Bxe6 fork" (recall debug)

Status: **open investigation**. Owner reported a real game where they expect two
moves to be flagged as missed tactics, but the scan does not flag them (it now
flags a *different* move — their 15th — which is a real miss but not the one
they asked about). This session grew too large; this file is the full handoff
for a fresh session.

Conventions: follow `AGENTS.md` context discipline + Execution policy. Use
narrow tests first, full gate before commit. Do **not** commit scratch e2e
probe files (`tests/e2e/zz-*` are throwaway and must be deleted before any
commit).

---

## 0. Current HEAD and what changed recently

Working tree must be **clean at `f737b70`** when this is read. Recent commits:

- `340e23f` feat(010): scan report with rejection reasons, surfaced crashes,
  lower objective floors — Game Review "Tactics scan report" summary, per-guard
  `rejectionReason` persisted on candidate rows, crashed pass → `failed`,
  difficulty rejection floor removed (`DETECTION_VERSION` 5), `winning_material`
  floor 3 → 2 points (`DETECTION_VERSION` 6).
- `ea6416d` feat(010): persist + show the engine's top line per rejected
  candidate (`verificationTopLine` on rows; per-ply "engine best …" debug list
  in the Review scan report).
- `f737b70` feat(010): remove unicity gate — `best-move-not-unique` is no longer
  a rejection (`DETECTION_VERSION` 7); near-equal second moves join
  `acceptedFirstMoves`.

Engine-rule knobs that are now **no-ops/removed**: ADR-025 difficulty floor
(difficulty still computed+persisted), unicity/win-chance gate, `>= 3` material
bound (now `>= 2`).

**Cleanup the owner requested but is NOT yet committed** (a partial edit was
reverted to keep the tree clean): *"remove the debugging from the Game Review
page (tactics scan report)"*. Decide exactly what that means:
- (a) remove only the per-ply "engine best … · pv" debug list added by
  `ea6416d` (summary counts remain), or
- (b) remove the whole Review scan-report block (also the
  `scanReport`/`scanReportSentence`/`REJECTION_LABELS` plumbing + hook read +
  the two GameReviewPage scan-report tests + the CSS) — then decide whether the
  domain `report.ts` summarizer and `verificationTopLine` persistence stay as
  inert data or get removed too.
Owner's wording suggests (b) but confirm.

---

## 1. The problem (owner report)

The game (owner = White):

```
1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. d3 f6 7. Ne4 Be6
8. O-O Qd7 9. Bd2 a6 10. Nc5 Bxc5 11. c3 Nb6 12. Bb3 Na5 13. Qh5+ Kd8 14. d4
exd4 15. Qxc5 Bxb3 16. Qxa5 Be6 17. Re1 d3 18. Re4 Nc4 19. Qb4 b5 20. Rd4 Nd6
21. Bf4 a5 22. Bxd6 axb4 23. Bxc7+ Kxc7 24. Rxd7+ Kxd7 25. Nd2 Rxa2 26. Rf1
Rxb2 27. Ne4 d2 28. Rd1 1-0
```

Owner's claim: White's **13th** (`13.Qh5+`, ply 24) and **14th** (`14.d4`,
ply 26) are misses. Instead of `13.Qh5+`/`14.d4`, White should play the
sequence **`13.Bxe6 Qxe6 14.b4 Bxb4 15.cxb4`** → White wins Black's dark bishop
for a pawn = **+2 points**, all within 5 plies (`<= MAX_TACTIC_PLIES = 8`). If
Black declines `Bxb4`, White wins a full piece (+3). Owner agrees Bxe6 is the
best first move; the *material is won a couple of moves later*, not on the
first move. Owner: *"this is a tactic that should have been caught … ≥2 points
compared to before"*.

Latest owner feedback: after the `f737b70` (unicity removal) build they
re-scanned and it now flags **a different miss (their 15th move, `15.Qxc5`,
ply 28)** which is genuinely a miss, but the original 13th/14th STILL do not
surface.

---

## 2. What we already proved (real-engine probes on this PGN, via a throwaway
Playwright e2e; probe file deleted)

- Importing the PGN (Chess.com mock, user = White, `chessremedy`), analyzing on
  the **fast** Game-analysis profile, then running detection shows **Stage 1
  emits 11–13 candidates**, and the candidate set **includes plies 24 and 26**
  (your 13th and 14th moves).
- The scan is slow (~3–4 min for ~11–13 depth-22 tactical searches) and in
  headless runs it frequently ended "interrupted" before the final write; a
  **Resume** finished it in seconds (verified rows reused + ADR-018 cache).
- Per-candidate Stage-2 outcomes before `f737b70` (from the debug per-ply
  report):
  - `ply 24`: rejected **"another move is as good"** (`best-move-not-unique`) —
    engine top `b3e6`, PV **`b3e6 d7e6 b2b4 c5b4 c3b4 a5c6 a2a4 e6d7`** — i.e.
    Stockfish's own line contains **exactly the owner's `Bxe6 Qxe6 b4 Bxb4
    cxb4`** (+2). It was discarded by the *unicity* gate, not by "no objective".
  - `ply 26`: rejected **"no objective reached"** — engine top `b3e6`, PV
    `b3e6 d7e6 b2b4 g7g6 h5h4 g6g5 h4h5 c5b4`. Note: Black's reply `g7g6` is
    *quiet*, so the walk **stabilised** (two consecutive non-forcing plies) and
    stopped before the material was won.
  - Other candidates: mostly "no objective reached" (engine best was a quiet
    improvement, e.g. `b1c3`, `c4e6`, `a2a3`).
- After `f737b70` (unicity removed, fresh import, real engine): the scan now
  reports **1 missed tactic** in ~50 s. The probe did **not** print which ply
  verified, so it is **unconfirmed whether that 1 is ply 24 (the owner's 13th)
  or ply 28 (the 15th, which the owner says now shows up)**. This is the #1 open
  fact to re-establish.

### Consequence of these findings

The algorithm *can* recognise the exact +2 line when it is the engine's top
line. The remaining blockers observed were:

1. **Unicity** (fixed in `f737b70`) — caused the ply-24 miss.
2. **Stabilisation / forcingness walk** — a quiet *middle* move by the defender
   (e.g. `…g6` rather than `…Bxb4`) stops the walk before the fork material is
   actually collected → "no-objective". This is the main suspect for why ply 26
   (and possibly ply 24 in some runs) still does not verify. A fork is a
   *threat-based* tactic: not every ply is a check/capture, but the material is
   nevertheless forced within a few moves. The current walker requires two
   consecutive forcing plies to keep going.
3. **Stage-1 candidate existence** is engine-dependent: a candidate for a ply
   is only emitted if the stored bulk-analysis record has
   `bestMove != playedMove` (and evals). Different profiles/depths/engine
   versions can change whether ply 24/26 produce a candidate at all (e.g., if
   the engine at the used depth considers `13.Qh5+` best, there is no miss to
   flag).
4. **Idempotent re-run**: `runPassForCompletedJob` **returns immediately** if
   the analysis's summary is already `detectionState: 'completed'`. Re-running
   a scan on an analysis that completed under an older rule version is a no-op;
   the user must **Re-analyze the game** (new analysis identity) to apply new
   detection rules. Confirm the user did that (they said "ran the tactics scan
   again"; if they only pressed a scan/resume action on a `completed` summary,
   nothing changed).
5. Candidate set + engine MultiPV top line vary slightly between runs/sessions
   (the observed candidate count ranged 11–13), so whether the fork verifies is
   not fully deterministic.

---

## 3. Investigation/debug plan for the next session (in order)

### A. Re-establish ground truth deterministically
1. Recreate the throwaway probe (`tests/e2e/zz-recall-probe.spec.ts`, then
   **delete it before committing** — see plan §5). Import the PGN (White =
   `chessremedy`), analyze on **fast**, and after the scan settles/resumes,
   print per-candidate rows *including which ply verified*. Two ways:
   - Extend the Review scan report debug list to include verified plies too, or
   - read `puzzleCandidates` from the page's IndexedDB (`open('chessremedy', 7)`,
     store `puzzleCandidates`) and dump `{sourcePly, verificationStatus,
     rejectionReason, verificationTopLine}`. NOTE: earlier attempts to read
     IndexedDB via `page.evaluate` returned empty even though the UI read the
     same DB — verify the DB name/version and that the evaluate runs in the
     page's top frame before trusting it; the UI-based dump is the safer path.
2. Determine **which ply** the current `f737b70` build verifies for this PGN
   (suspect: ply 28 / move 15, or ply 24). This tells us whether unicity removal
   already fixed ply 24 and only ply 26 (stabilisation) remains, or neither.
3. For **ply 24 and ply 26 specifically**, capture:
   - the stored bulk `MoveAnalysis` for those plies (was a candidate even
     emitted? `bestMove`, `evalBefore/evalAfter`, `wpLoss`),
   - the Stage-2 engine MultiPV top line + eval + WDL,
   - the Stage-2 verdict and reason.
   Do this by re-adding the per-ply debug list (see cleanup note) or via a
   one-off instrumented build; do not guess.

### B. Fix candidates, in order of likely impact (owner wants "if I missed it,
show it")
1. **Stabilisation for threat-based wins.** Change `prefixScan`/`verify.ts` so a
   fork/pin whose *engine line* collects `>= WINNING_MATERIAL_MIN_DELTA` within
   `MAX_TACTIC_PLIES` counts as `winning_material` even when a quiet defender
   move sits in the middle, while still avoiding "quiet positional
   improvement" false positives (e.g., only relax stabilisation when the line
   still *ends* with a retained material gain on the full ≤8-ply line, or when
   material was captured and the defender's quiet reply did not restore
   material). This is the strongest candidate for the remaining misses.
   - Risk: more engine time per accepted tactic is unchanged (candidates
     already searched), but more candidates may *verify* → more noise until
     Feature-011 quality thresholds exist. Add domain tests with quiet-move
     forks (see §4).
   - Any semantics change ⇒ bump `DETECTION_VERSION` and update ADR-026 /
     `research/tactical-detection.md` / Feature-010.
2. **Idempotency vs new rules.** Make sure stale completed summaries are not
   silently stale: either expose a "re-scan with current rules" path that
   re-runs when the stored `detectionVersion` < current `DETECTION_VERSION`
   (ADR-020-style opt-in), or instruct the user that a new detection pass
   requires **Re-analyze** (new identity). Consider surfacing "new detection
   rules available — re-scan" when versions differ.
3. **Stored-analysis "better move" surface (fallback / owner's real want).** If
   deep-pass agreement on these fork plies stays unreliable, add a deterministic
   per-ply "better move" indicator derived from the **game's own stored
   analysis** (which the app already has per ply): whenever the user's move was
   not the engine best AND the engine-best PV/eval implies a ≥2-point gain
   within the engine's horizon, show it in Review as "you could have played
   Bxe6 → … (+2)" — separate from (or in addition to) the strict
   verified-tactics list. This does not depend on Stage-2's forcing walk at all.
   Product question for the owner before building (surface/name, how it
   interacts with `Missed tactics` count, avoid double-reporting with verified
   candidates).

### C. Scan reliability (secondary but real)
- In headless/slow environments the pass ends "interrupted" before the final
  write; a Resume finishes fast. Confirm the crash→`failed` handling from
  `340e23f` works, and decide whether to make scans complete without a manual
  resume when they finish all candidates (look at why the pass writes `queued`
  instead of `completed` right at the end in those runs — root cause not fully
  pinned down; the last candidates' settle→final-write window seemed to race an
  abort in the sandbox).

---

## 4. Deterministic unit/domain tests to add (independent of the real engine)

These prove the algorithm *can* catch the shape, so the remaining gap is engine
behaviour, not code capability:

- `verify.test`: a candidate whose MultiPV top line is
  `Bxe6 Qxe6 b4 Bxb4 cxb4` (5 plies, net material +2, retention) →
  `verifyCandidate` returns `winning_material` with `candidateSolutionLength 5`
  (this exercises the ≥2 floor and retention).
- The quiet-defender variant `Bxe6 Qxe6 b4 g6 …` where material is won later —
  assert current behaviour (no-objective due to stabilisation) so the fix in
  §B1 has a regression test that flips it.
- `stage1.test`: quiet fork with small wpLoss still emits when `>= 2` material
  is available is out of scope of Stage-1 (Stage-1 cannot know); keep Stage-1
  focused on the triggers, do not assert engine-specific eval.
- Keep `report.test.ts` aligned if the scan-report UI/domain is trimmed (§0).

To get a real FEN for those unit tests, replay the PGN with the domain
`gameFromPgn`/move list helpers to the ply, or paste the FEN captured by the
probe.

---

## 5. Housekeeping for the next session

- Scratch files: `tests/e2e/zz-*.spec.ts` are throwaway — never commit them;
  delete after use.
- Pending cleanup (owner asked): remove the scan-report debugging from the Game
  Review page — decide (a) per-ply list only or (b) whole block; finish and
  commit, updating GameReviewPage tests and Feature-010 spec accordingly.
- Re-check commits `340e23f`/`ea6416d`/`f737b70` changed behaviour across
  **detection versions 5→7**; if the owner re-runs detection they must get a
  fresh analysis identity (Re-analyze) for the new rules to apply.
- Verification commands (AGENTS gate): focused `npx vitest run
  src/domain/tactics src/infrastructure/tactics src/infrastructure/analysis`,
  then `npm run lint/typecheck/format:check/test/build`, then
  `npm run test:browser -- game-analysis-review`, `npm audit`. Real-engine
  probes need `npm run build` first (Playwright previews the built `dist`).
- Owner feedback loop: after each candidate fix, re-run the §3A probe on this
  exact PGN and report which ply(ies) now verify, with engine PVs, before
  declaring the recall issue resolved.

## 6. Open product questions for the owner

1. Confirm the intended cleanup scope for the Review scan report (§0).
2. Is a fork whose material is collected after a *quiet* defender reply (e.g.
   ply 26 here) definitely a "missed tactic" to surface, even if the pass
   requires relaxing stabilisation and thus shows more borderline items?
3. Should we add the deterministic stored-analysis "better move ≥2" surface
   (independent of Stage-2) as the primary recall mechanism?
4. Confirm the user re-runs via **Re-analyze** (fresh identity), not Resume of a
   completed scan, when testing new detection builds.
