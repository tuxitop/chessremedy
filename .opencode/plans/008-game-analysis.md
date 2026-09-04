# Plan — Feature 008: Game Analysis & Game Review

## Objective

Analyze imported games with the existing Stockfish service (Feature 005)
and persist game-scoped `MoveAnalysis` with canonical classification and
game phase. Ship the Game Review surface. Feature 008 is independently
implementable/testable after Features 002/003/004/005/007 and never
depends on Features 009/010/011.

## Dependency contract (specs, already corrected)

```
Chess Domain (003) → Stockfish Service (005) → Game Analysis (008)
  → persisted MoveAnalysis (classification + phase, canonical domain rules)
  → Game Review / tactical detection (010) / puzzles (011) / stats (014)
```

Canonical rules consumed (never invented here): `domain/classification.md`
(ADR-023), `domain/game-phase.md`, schema in `domain/analysis-model.md`.
`missedTactic` is reserved on `MoveAnalysis` and filled later by Feature
010 — Feature 008 must not compute detection.

## Domain changes (`src/domain/`)

- MoveAnalysis types + analysis identity/version (pure).
- Position extraction over the chessops move tree (Feature 002/003).
- Classification application + game-phase application functions calling
  the canonical domain algorithms (versioned).
- Missing: none — specs are now canonical.

## Data/storage changes (schema v4, additive)

- Dexie `analyses` (per-game metadata + per-move `MoveAnalysis`) and
  `analysisJobs` (persistent queue) tables; bump
  `PERSISTENCE_SCHEMA_VERSION → 4` with an additive v4 migration test.
- Analysis repository: save/get-by-game/query-by-(gameId, analysisId),
  queue repository with statuses `queued | inProgress | completed |
  cancelled | failed`, resume/cancel/retry + duplicate-job guard.
- Extend the Feature 007 `deleteGames` cascade to remove game-scoped
  analysis rows/jobs; **never** purge the FEN-keyed engine cache
  (ADR-018). Covered by persistence tests.

## Application changes

- Analysis orchestrator built on the existing Feature 005 engine service
  (injected transport; **no new worker/service/profile definitions**);
  single-game and batch (one logical job per selected game, independent
  failures, aggregate + per-game progress, restart-safe resume).
- Feature 007 Game Library integration: enable the bulk `Analyze`
  action, register per-row `Review`/`liveAnalysis` row actions and
  expose analysis status (`unanalyzed|queued|inProgress|completed|
  cancelled|failed`) through the Library capability/insight seams — no
  duplicated filtering/selection/provider logic.

## UI changes

- Game Review at `/games/:id/review`: shared Chessground-10.1.1
  `<Chessboard/>` (Feature 002), chessops move tree, ADR-023 glyphs,
  click-to-seek + `aria-current="step"`, summary panel from persisted
  records (user vs opponent separation; missed-tactic count from the
  reserved attribute, zero until Feature 010), and explicit
  no-analysis/in-progress/failed/obsolete-version states.

## Testing

- Domain: position extraction, ply ordering, classification + phase
  determinism, identity/version.
- Persistence: save/get/restart, partial resume, completed retention,
  deletion cascade (analysis gone, engine cache retained).
- Service: fake Stockfish engine (existing test-support) covering
  positions submitted, results stored, MultiPV preserved, failures,
  cancellation, progress; ≥1 integration test against the real Feature
  005 engine on a known position without blocking the UI.
- Batch: single/multi/mixed success-failure/cancel/restart/retry/
  duplicate suppression.
- Review: board/move-list/seek/aria/glyphs/summary/user-opponent/
  missing/failed/obsolete states; one e2e fixture workflow
  (analyze → review → navigate → verify → delete).

## Verification

Focused vitest → full gate (`lint`, `typecheck`, `format:check`, `test`,
`build`, `dev` smoke, `test:browser`, `audit`).

## Deferred (out of scope)

Tactical detection and `missedTactic` population (Feature 010), puzzle
generation/training (011/012/013), statistics (014) — all consume 008's
persisted output later.
