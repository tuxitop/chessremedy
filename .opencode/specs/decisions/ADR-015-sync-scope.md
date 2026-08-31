# ADR-015: Sync Scope (Dropbox App Folder)

## Status

Accepted

## Decision

ChessRemedy uses the **Dropbox App Folder** access type for V1
synchronization. The sync file lives at `/Apps/ChessRemedy/sync.json.gz`
inside the user's Dropbox.

## Reasons

- ChessRemedy only needs to sync its own data; it has no reason to read
  or write any other part of the user's Dropbox.
- App Folder access follows the least-privilege principle required by
  `AGENTS.md` ("Prefer local processing and local storage").
- App Folder apps have an easier Dropbox production-approval process than
  Full Dropbox apps.
- Users are more comfortable granting limited scope.
- Path isolation (`/Apps/ChessRemedy/...`) is provided automatically by
  Dropbox and requires no additional logic in the application.

## Required scopes

- `files.content.read`
- `files.content.write`
- `files.metadata.read`
- `account_info.read` (optional, for user identification)

## Consequences

- A future migration to Full Dropbox would require a new ADR and would
  invalidate stored OAuth tokens.
- The sync engine must not assume any path outside `/Apps/ChessRemedy/`.
- OAuth token storage, conflict resolution and file format are governed
  by ADR-016 and ADR-017, not by this ADR.

## Sources

- `specs/research/synchronization.md` (App Folder vs Full Dropbox)
- `specs/PRODUCT.md` §16
- `specs/ARCHITECTURE.md` §8
- ADR-008 (Synchronization architecture)
