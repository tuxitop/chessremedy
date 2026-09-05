# ChessRemedy — Context Map

Tells an agent exactly which documents to load for a task. Paths are
relative to `.opencode/specs/` unless prefixed (`.opencode/…`).

**Global minimal context for any feature task:**

1. `AGENTS.md` (root)
2. `.opencode/DECISIONS.md`
3. `ARCHITECTURE.md`
4. `.opencode/CONTEXT-MAP.md`
5. the feature specification
6. only the `Required` documents the feature lists below.

**Rules:** `history/` (superseded ADRs) and `research/` are **not**
default context — load research only when a feature lists it; consult
history only to answer "why did we decide this?". Do not read unrelated
features, ADRs, research, or the whole documentation tree.

## Feature context

### Feature 001 — Foundation
- Required: `ARCHITECTURE.md`, DECISIONS.md; ADRs `decisions/ADR-001`, `decisions/ADR-009`, `decisions/ADR-027`; research `research/testing-stack.md`.
- Dependencies: none.

### Feature 002 — Chessboard & Chess Interaction
- Required: `ARCHITECTURE.md` §4; ADRs `decisions/ADR-002`, `decisions/ADR-014`, `decisions/ADR-028`, `decisions/ADR-030`, `decisions/ADR-009`; domain `domain/game-model.md`; research `research/testing-stack.md`.
- Optional: `history/ADR-029` (why pgn-viewer was dropped); Feature 003 (domain types the move list wraps).
- Dependencies: Features 001, 003; (playground engine placeholder: Feature 005).

### Feature 003 — Chess/Game Domain & Deterministic Fixtures
- Required: `ARCHITECTURE.md`; ADRs `decisions/ADR-028`, `decisions/ADR-013`, `decisions/ADR-001`; domain `domain/game-model.md`, `domain/time-control.md`, `domain/clock.md`; research `research/testing-stack.md`.
- Optional: `history/ADR-003` (rejected chess.js), research `research/game-import.md` (provider header shapes).
- Dependencies: Features 001, 002 (none hard).

### Feature 004 — Local Game Storage
- Required: `ARCHITECTURE.md` §7; ADRs `decisions/ADR-001`, `decisions/ADR-009`; domain `domain/game-model.md`; research `research/testing-stack.md`.
- Optional: `decisions/ADR-018` (later table precedent).
- Dependencies: Features 001, 003.

### Feature 005 — Stockfish
- Required: `ARCHITECTURE.md` §2/§5; ADRs `decisions/ADR-004`, `decisions/ADR-012`, `decisions/ADR-018`, `decisions/ADR-020`, `decisions/ADR-009`, `decisions/ADR-027`; domain `domain/analysis-model.md`; research `research/browser-stockfish.md`.
- Dependencies: Features 001, 002, 003.

### Feature 006 — Live Analysis Board
- Required: `ARCHITECTURE.md` §5; ADRs `decisions/ADR-012`, `decisions/ADR-018`, `decisions/ADR-019`, `decisions/ADR-020`, `decisions/ADR-033`, `decisions/ADR-009`; domain `domain/analysis-model.md`; research `research/browser-stockfish.md`.
- Optional: ADR-023 + `domain/classification.md` (glyph rendering arrives with Feature 009; not computed here).
- Dependencies: Features 002, 003, 005.

### Feature 007 — Game Import & Library
- Required: `ARCHITECTURE.md`; ADRs `decisions/ADR-001`, `decisions/ADR-009`, `decisions/ADR-013`, `decisions/ADR-018`; domain `domain/game-model.md`, `domain/game-library.md`; research `research/game-import.md`.
- Dependencies: Features 001, 003, 004 (persistence + duplicate detection).

### Feature 008 — Game Analysis
- Required: ADRs `decisions/ADR-012`, `decisions/ADR-018`, `decisions/ADR-019`, `decisions/ADR-020`, `decisions/ADR-023`, `decisions/ADR-026`, `decisions/ADR-033`, `decisions/ADR-009`; domain `domain/analysis-model.md`, `domain/classification.md`, `domain/game-phase.md`, `domain/game-model.md`, `domain/time-control.md`, `domain/clock.md`; research `research/browser-stockfish.md`, `research/move-classification.md`.
- Dependencies: Features 002, 003, 004 (persistence), 005 (Stockfish service + profiles), 007 (Game Library entry/status). Classification and game-phase rules are canonical domain rules (never later features). Output consumed by Features 009/010/011/014.

### Feature 009 — Move Classification (post-008 tooling)
- Required: ADRs `decisions/ADR-005`, `decisions/ADR-019`, `decisions/ADR-023`, `decisions/ADR-024`, `decisions/ADR-026`; domain `domain/classification.md`, `domain/analysis-model.md`; research `research/move-classification.md`, `research/move-accuracy.md`.
- Dependencies: Feature 008 (persisted `MoveAnalysis[]` input). The canonical classifier is domain-owned and applied inside Feature 008, so Feature 009 never gates 008. Output: classification tooling (glyph/accuracy surfacing per ADR-024) and statistics helpers consumed by Features 008 (review polish)/014/015.

### Feature 010 — Tactical Detection
- Required: ADRs `decisions/ADR-026`, `decisions/ADR-023`, `decisions/ADR-024`, `decisions/ADR-025`, `decisions/ADR-012`, `decisions/ADR-018`, `decisions/ADR-019`, `decisions/ADR-020`; domain `domain/tactics.md`, `domain/analysis-model.md`, `domain/puzzle-model.md`, `domain/classification.md`, `domain/game-library.md`; research `research/tactical-detection.md`, `research/move-classification.md`.
- Dependencies: Features 005, 007 (Library surface + canonical filter state), 008 (persisted `MoveAnalysis` + analysis status), 009 (per-game summary/accuracy tooling); output consumed by Features 011, 014 and by the Game Library read-only row insights.

### Feature 011 — Tactical Puzzle Generation
- Required: ADRs `decisions/ADR-006`, `decisions/ADR-025`, `decisions/ADR-026`, `decisions/ADR-012`, `decisions/ADR-018`, `decisions/ADR-031`; domain `domain/puzzle-model.md`, `domain/tactics.md`, `domain/tactical-training.md`; research `research/puzzle-generation.md`, `research/tactical-detection.md`.
- Dependencies: Feature 010 (candidates); output feeds Feature 013.

### Feature 012 — Puzzle Training
- Required: `ARCHITECTURE.md` (post-solve reuse of Feature 006); ADRs `decisions/ADR-031`, `decisions/ADR-023`, `decisions/ADR-018`; domain `domain/tactical-training.md`, `domain/puzzle-model.md`; research `research/cycle-training.md`.
- Optional: `history/ADR-007/011/021/022` (rejected scheduling), `history/README.md`; `PRODUCT.md` §10 (hint levels — authoritative owner).
- Dependencies: Features 006, 008, 011, 013.

### Feature 013 — Tactical Training Cycles
- Required: ADRs `decisions/ADR-031`, `decisions/ADR-025` (difficulty ordering default); domain `domain/tactical-training.md`, `domain/puzzle-model.md`; research `research/cycle-training.md`.
- Optional: `history/ADR-007/011/021/022` (rejected FSRS), research `research/fsrs-implementation.md` (deferred future scheduler).
- Dependencies: Feature 011 (puzzle source), Feature 012 (solve interaction); consumers Features 014/015.

### Feature 014 — Game Analysis History & Statistics
- Required: ADRs `decisions/ADR-013`, `decisions/ADR-023`, `decisions/ADR-024`, `decisions/ADR-019`, `decisions/ADR-020`; domain `domain/statistics.md`, `domain/game-model.md`, `domain/analysis-model.md`, `domain/classification.md`, `domain/tactical-training.md`; research `research/move-accuracy.md`, `research/move-classification.md`.
- Dependencies: Features 008/009/010 (game data), 012/013 (attempts/cycles); output consumed by Feature 015.

### Feature 015 — Dashboard
- Required: `ARCHITECTURE.md` §6a; ADRs `decisions/ADR-010`, `decisions/ADR-013`, `decisions/ADR-023`, `decisions/ADR-024`; domain `domain/statistics.md`, `domain/tactical-training.md`, `domain/game-model.md`; research `research/charting-library.md`.
- Dependencies: Feature 014 (sole read-only data source), Feature 013 (training data).

### Feature 016 — Synchronization
- Required: `ARCHITECTURE.md` §8; ADRs `decisions/ADR-008`, `decisions/ADR-015`, `decisions/ADR-016`, `decisions/ADR-017`, `decisions/ADR-001`, `decisions/ADR-018` (cache is not synced); domain `domain/game-model.md`, `domain/tactical-training.md`; research `research/synchronization.md`.
- Dependencies: Features 001, 003, 004 (persistence), 008 (analysis), 013 (training data).

## Lookup: decisions by area

- Chess rules/PGN: ADR-028 · Chessboard: ADR-002/014/030 · Engine: ADR-004/012/018/020 · Analysis/classification/board: ADR-005/019/023/024/026/033 · Puzzles/training: ADR-006/025/031 · Time control: ADR-013 · Sync: ADR-008/015/016/017 · Storage: ADR-001/018/019 · Testing: ADR-009 · Charts: ADR-010 · License: ADR-027.

## Lookup: research by consumer

| Research | Informs |
|----------|---------|
| `research/browser-stockfish.md` | Features 005/006/008; ADR-004/012/018/020 |
| `research/move-accuracy.md` | ADR-024; Feature 014 |
| `research/move-classification.md` | ADR-023; Features 006/008/009/010/014 |
| `research/tactical-detection.md` | ADR-026; Feature 010/011 |
| `research/puzzle-generation.md` | ADR-025; Feature 011 |
| `research/cycle-training.md` | ADR-031; Features 012/013 |
| `research/fsrs-implementation.md` | Deferred future scheduler (not V1) |
| `research/game-import.md` | Feature 007; ADR-013 fixture shapes |
| `research/synchronization.md` | ADR-008/015/016/017; Feature 016 |
| `research/charting-library.md` | ADR-010; Feature 015 |
| `research/testing-stack.md` | ADR-009; Features 001–004 |

## Lookup: domain specs by feature

- `domain/game-model.md` → Features 002/003/004/007/014/015/016
- `domain/game-library.md` → Features 007/008/010/011/014/016
- `domain/analysis-model.md` → Features 005/006/008/009/010/014
- `domain/classification.md` → Features 006/008/009/010/014
- `domain/time-control.md` → Features 003/007/008/014/015
- `domain/clock.md` → Features 003/008
- `domain/game-phase.md` → Features 008/014/015
- `domain/tactics.md` → Features 010/011
- `domain/puzzle-model.md` → Features 010/011/012/013
- `domain/tactical-training.md` → Features 011/012/013/014/015/016
- `domain/statistics.md` → Features 014/015
