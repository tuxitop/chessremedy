# ChessRemedy — Current Decisions Index

An index of **current** architectural decisions. Each row links to the
authoritative ADR, which carries the full rationale. Superseded
decisions are moved to [`specs/history/`](specs/history/README.md) and
are **not** current.

Read order for any feature task:

1. `AGENTS.md`
2. `DECISIONS.md`
3. `specs/ARCHITECTURE.md`
4. `CONTEXT-MAP.md`
5. the feature specification
6. only the documents the feature / context map lists.

## Decisions

| ID | Decision | Status | Applies to |
|----|----------|--------|-----------|
| [ADR-001](specs/decisions/ADR-001-local-first.md) | Local-first: IndexedDB is the primary store; no backend required; app stays useful offline; sync is optional | Accepted | All |
| [ADR-002](specs/decisions/ADR-002-chessground.md) | Chessboard uses `@lichess-org/chessground` behind our own wrapper | Accepted | Board/UI |
| [ADR-004](specs/decisions/ADR-004-stockfish.md) | Stockfish runs locally in Web Workers; engine analysis must never block the UI | Accepted | Analysis/Engine |
| [ADR-005](specs/decisions/ADR-005-analysis-model.md) | Contextual engine analysis and classification, not a single centipawn threshold | Accepted | Analysis/Classification |
| [ADR-006](specs/decisions/ADR-006-puzzle-generation.md) | Puzzles come from verified tactical opportunities, may be multi-move, engine-verified | Accepted | Puzzle generation |
| [ADR-008](specs/decisions/ADR-008-synchronization.md) | Provider-independent sync engine; Dropbox is the first provider | Accepted | Sync |
| [ADR-009](specs/decisions/ADR-009-testing-stack.md) | Vitest + Testing Library + happy-dom/jsdom + fake-indexeddb + MSW (consumer-installed) + Playwright | Accepted | Testing |
| [ADR-010](specs/decisions/ADR-010-charting-library.md) | Recharts for dashboard charts | Accepted | Dashboard |
| [ADR-012](specs/decisions/ADR-012-stockfish-wasm.md) | `stockfish` npm package (WASM); default single-thread lite build; profiles `fast`/`normal`/`tactical`/`deep`; global thread budget `min(hardwareConcurrency, 8)`, Threads only on the multi-threaded `lite` build | Accepted | Engine |
| [ADR-013](specs/decisions/ADR-013-time-control-categories.md) | Structured time-control model: **platform-specific** categories (Chess.com/Lichess published boundaries; `generic` for local/fixture), raw preserved, `M|I` display; versioned v11 re-normalization; source labels kept as hints | Accepted | Statistics/Domain |
| [ADR-014](specs/decisions/ADR-014-chessground-version.md) | Chessground must stay `^10.1.1` within 10.x; major upgrades need a new ADR | Accepted | Board/UI |
| [ADR-015](specs/decisions/ADR-015-sync-scope.md) | V1 sync uses Dropbox App Folder; single `sync.json.gz` | Accepted | Sync |
| [ADR-016](specs/decisions/ADR-016-sync-file-format.md) | Sync payload = versioned gzipped JSON envelope of collections | Accepted | Sync |
| [ADR-017](specs/decisions/ADR-017-sync-conflict-resolution.md) | JSON-level merge with last-write-wins fallback + Dropbox `rev` retry | Accepted | Sync |
| [ADR-018](specs/decisions/ADR-018-engine-analysis-cache.md) | Position-keyed engine cache keyed by FEN + profile/engine identity + effective game-analysis overrides (depth/search-time/threads); the detection scope also includes the effective verification depth and verification threads; never synced | Accepted | Engine/Storage |
| [ADR-019](specs/decisions/ADR-019-wdl-storage.md) | Nullable `wdl` per-mille stored on every `MoveAnalysis` (null for `fast`) | Accepted | Analysis/Storage |
| [ADR-020](specs/decisions/ADR-020-engine-version-upgrade-policy.md) | Lazy, opt-in re-analysis on engine upgrades; engine metadata versioned | Accepted | Engine |
| [ADR-023](specs/decisions/ADR-023-move-classification-thresholds.md) | Move classification via `wpLoss` at winning-chance-loss thresholds 0.10/0.20/0.30 (≈5/10/15 win%) calibrated to Lichess `Advice.scala`; mate transitions unannotated (see ADR). Amended: a current-version verified missed tactic is exclusive (no additional error classification) | Accepted | Classification |
| [ADR-024](specs/decisions/ADR-024-move-accuracy-formula.md) | Per-move accuracy via the Lichess curve; per-game accuracy = Lichess `gameAccuracy` (volatility-weighted/harmonic blend); versioned | Accepted | Analysis/Statistics |
| [ADR-025](specs/decisions/ADR-025-puzzle-difficulty-formula.md) | Deterministic `[0,100]` puzzle difficulty; five buckets; `<15` filter | Accepted | Puzzles |
| [ADR-026](specs/decisions/ADR-026-tactical-verification-pipeline.md) | Two-stage tactical verification pipeline; user-tunable verification depth (default 22) on a dedicated verification engine | Accepted | Tactical detection |
| [ADR-027](specs/decisions/ADR-027-license-gpl.md) | ChessRemedy licensed GPL-3.0-or-later | Accepted | All |
| [ADR-028](specs/decisions/ADR-028-chessops.md) | Chess rules/state/PGN via `chessops` (no chess.js) | Accepted | Chess domain |
| [ADR-030](specs/decisions/ADR-030-drop-pgn-viewer.md) | Drop `@lichess-org/pgn-viewer`; custom `MoveList` on `chessops/pgn` | Accepted | Board/MoveList |
| [ADR-031](specs/decisions/ADR-031-tactical-training-cycles.md) | V1 tactical training = cycle-based over fixed sets; no FSRS/per-puzzle scheduler | Accepted | Puzzle training |
| [ADR-032](specs/decisions/ADR-032-typescript-version.md) | TypeScript tracks the latest stable supported by the current `typescript-eslint` peer range; no override | Accepted | Toolchain |
| [ADR-033](specs/decisions/ADR-033-unified-analysis-board.md) | One shared analysis-board surface for Review (stored) and Live Analysis (engine); live never overwrites stored analysis; exploration non-destructive; numeric eval text White-positive, bar height bottom-oriented | Accepted | Analysis/Board |
| [ADR-034](specs/decisions/ADR-034-dedicated-verification-engine.md) | Dedicated tactical-verification engine worker (own FIFO, lazy/idle lifecycle) and global thread budget `B = min(hardwareConcurrency, 8)`: verification 1 thread, analysis `max(1, B - 1)`; two engines never at maximum together | Accepted | Engine/Tactical detection |

## Critical Constraints

Decisions an agent must respect even when working on an unrelated
feature:

- Chessground MUST be `@lichess-org/chessground@10.1.1` or higher, and
  MUST stay within the 10.x major range. Major upgrades require a new
  ADR (ADR-014; AGENTS.md "Mandatory chessboard dependency").
- Stockfish MUST run in a Web Worker; the UI must never synchronously
  execute engine analysis (ADR-004).
- The application is local-first: IndexedDB (via Dexie) is the primary
  persistent store; no backend is required (ADR-001).
- V1 tactical training uses cycle-based training over fixed puzzle sets
  (ADR-031). There is no per-puzzle scheduler and no FSRS dependency in
  V1; the data model stays open to a future individual scheduler.
- Dropbox synchronization is optional backup/export infrastructure, not
  the primary database; the app must work without it (ADR-001/008).
- Domain logic must not depend on React/UI (ARCHITECTURE.md §3).
- New dependencies must satisfy the Dependency policy and license
  posture in AGENTS.md (ADR-027).

## Notes

- Version numbers beyond the Chessground pin live in `package.json` /
  the lockfile, not in ADRs (AGENTS.md Dependency policy).
- Analysis profiles use the canonical names `fast` / `normal` /
  `tactical` / `deep` (ADR-012). See ADR-012 for parameters.
