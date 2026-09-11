# Feature 016 — Synchronization

## Goal

Synchronize local ChessRemedy data across devices.

## Requirements

- sync abstraction
- provider interface
- Dropbox provider
- push
- pull
- conflict detection
- offline queue
- sync status
- recovery

## Constraint

The application remains fully usable without synchronization.

## Deletion & derived state

Deletions sync as tombstones consistent with the ownership rule
(`ARCHITECTURE.md` §7, `domain/game-library.md`): deleting a game on one
device removes the same game-scoped derived rows everywhere, and deleting
a game never purges shared FEN-keyed engine cache entries (ADR-018).
Game Library filter/search/selection state (ephemeral, URL-encoded) and
derived per-game insights are never synced.

Derived time-control fields (`timeControlModel`, `normalizedTimeControl`)
are recomputed from the verbatim `timeControl` and the game's `source` on
import and on sync merge; they are never trusted from a remote payload, so
a device on an older time-control category mapping cannot reintroduce a
stale category (ADR-013, `domain/time-control.md`).

## Acceptance Criteria

Two devices can synchronize the same user's data without requiring a
central ChessRemedy backend.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` §8; `decisions/ADR-008`,
  `decisions/ADR-015`, `decisions/ADR-016`, `decisions/ADR-017`,
  `decisions/ADR-001`, `decisions/ADR-018` (cache is not synced)
- Domain: `domain/game-model.md`, `domain/tactical-training.md`,
  `domain/game-library.md`
- Research: `research/synchronization.md`

Feature dependencies: Features 001, 003, 004 (persistence), 008
(analysis), 013 (training data).
