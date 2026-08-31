# ADR-017: Sync Conflict Resolution

## Status

Accepted

## Decision

V1 conflict resolution is **JSON-level merge with last-write-wins
fallback**, using Dropbox rev-based optimistic concurrency for safety.

## Algorithm

1. Fetch the remote file's `rev` and `content_hash`.
2. Compare the local `content_hash` with the remote `content_hash`.
3. If identical, skip the upload.
4. If different:
   a. Download the remote payload (ADR-016).
   b. Merge remote collections into the local IndexedDB record-by-record.
   c. Re-upload the merged result using `mode: { ".tag": "update",
      "rev": "<remote rev>" }` (optimistic concurrency).
   d. On HTTP 409, refetch the remote `rev`, re-merge, and retry
      (max 3 attempts).
   e. After 3 failed attempts, preserve the remote payload as a
      timestamped backup and upload the merged result as a new file.

## Record-level merge

For each collection:

- Records are matched by their stable primary key (`id`).
- Records present on only one side are accepted as-is.
- Records present on both sides are compared by `updatedAt`. The record
  with the newer `updatedAt` wins.
- Ties on `updatedAt` are broken by `deviceId` (lexicographic order) so
  that the outcome is deterministic.

## Reasons

- ChessRemedy data is single-user, multi-device. Concurrent edits to
  the same record on two devices offline at once are rare.
- Each collection is independent, so JSON-level merge is sufficient
  for V1 without introducing CRDT or Operational Transform complexity.
- Optimistic concurrency (`rev`) prevents overwriting a remote change
  the local client has not seen.
- A bounded retry plus timestamped backup protects against pathological
  conflicts without blocking the user indefinitely.

## Consequences

- The sync engine must tolerate transient 409s and resync.
- All persisted records must carry an `updatedAt` and a stable `id` for
  the merge to be deterministic.
- The domain must not depend on Dropbox-specific concepts (`rev`,
  `content_hash`). They are encapsulated in the sync engine.
- A future iteration may introduce finer-grained CRDT-based merge if
  multi-user editing becomes a requirement.

## Sources

- `specs/research/synchronization.md` (Conflict Detection and
  Resolution)
- `specs/ARCHITECTURE.md` §8
- ADR-008 (Synchronization architecture)
- ADR-015 (Sync scope)
- ADR-016 (Sync file format)
