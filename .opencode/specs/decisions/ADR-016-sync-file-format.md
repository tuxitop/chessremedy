# ADR-016: Sync File Format

## Status

Accepted

## Decision

The V1 sync payload is a single gzipped JSON file with a top-level
metadata envelope. The conceptual shape is:

```json
{
  "version": 1,
  "exportedAt": "ISO-8601 timestamp",
  "deviceId": "stable UUID for the producing device",
  "collections": {
    "games":     { ... },
    "analysis":  { ... },
    "puzzles":   { ... },
    "fsrsCards": { ... },
    "settings":  { ... }
  }
}
```

## Reasons

- JSON is the natural representation for IndexedDB collections and is
  already used by the application layer.
- A versioned envelope allows future schema changes to be migrated
  without breaking older clients (see `Migration` below).
- Gzip reduces typical payload size by 70–90 %; a 1,000-game archive
  shrinks from ~5 MB to well under the Dropbox 150 MB single-upload
  limit.
- The `deviceId` field allows the sync engine to reason about which
  device last produced a snapshot and to deduplicate revisits.
- A single file keeps V1 conflict resolution simple (see ADR-017).

## Consequences

- The sync engine must gzip before upload and gunzip after download
  using the browser-native `CompressionStream` / `DecompressionStream`
  APIs (no extra dependency).
- The payload `version` is incremented on any breaking schema change.
  Reading clients must refuse a payload with a `version` they do not
  understand.
- Full-file uploads are used for V1; incremental sync is deferred.
- The file is uploaded with `Content-Type: application/gzip`.
- Domain records inside `collections` keep their existing Dexie shape;
  the envelope adds metadata only.

## Migration

A future migration is implemented by:

1. Reading the old payload version.
2. Applying versioned transform functions in sequence.
3. Writing the new payload version.

The first migration function must exist before the second payload
version is published.

## Sources

- `specs/research/synchronization.md` (File Format and Sync Strategy)
- `specs/ARCHITECTURE.md` §8
- ADR-008 (Synchronization architecture)
- ADR-015 (Sync scope)
- ADR-017 (Sync conflict resolution)
