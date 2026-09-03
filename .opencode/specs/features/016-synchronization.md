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

## Acceptance Criteria

Two devices can synchronize the same user's data without requiring a
central ChessRemedy backend.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` §8; `decisions/ADR-008`,
  `decisions/ADR-015`, `decisions/ADR-016`, `decisions/ADR-017`,
  `decisions/ADR-001`, `decisions/ADR-018` (cache is not synced)
- Domain: `domain/game-model.md`, `domain/tactical-training.md`
- Research: `research/synchronization.md`

Feature dependencies: Features 001, 003, 004 (persistence), 008
(analysis), 013 (training data).
