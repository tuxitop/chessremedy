# Feature 004 — Local Game Storage

## Goal

Persist chess games and related metadata locally.

## Requirements

Use IndexedDB through Dexie.

Support:

- insert
- retrieve
- update
- delete
- duplicate detection
- schema versioning

## Acceptance Criteria

Imported games survive browser restart.

Duplicate external games are not stored twice.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` §7; `decisions/ADR-001`,
  `decisions/ADR-009`; optional `decisions/ADR-018`
- Domain: `domain/game-model.md`
- Research: `research/testing-stack.md`

Feature dependencies: Features 001, 003.
