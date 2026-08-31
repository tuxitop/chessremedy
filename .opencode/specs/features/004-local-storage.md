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
