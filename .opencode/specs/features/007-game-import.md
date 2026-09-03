# Feature 007 — Game Import

## Goal

Import user games from Chess.com and Lichess.

## Requirements

- provider adapters
- batch import
- pagination
- duplicate detection
- progress
- errors
- retry
- resumability

## Acceptance Criteria

The user can import a batch of games from each supported platform.

Imported games have normalized metadata.

No game is analyzed automatically during import.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md`; `decisions/ADR-001`,
  `decisions/ADR-009`, `decisions/ADR-013`
- Domain: `domain/game-model.md`
- Research: `research/game-import.md`

Feature dependencies: Features 001, 003, 004 (persistence + duplicate
detection).
