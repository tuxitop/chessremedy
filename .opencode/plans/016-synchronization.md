# Plan — Feature 016: Synchronization

> Source of truth: `.opencode/specs/features/016-synchronization.md`.
> Required context per `.opencode/CONTEXT-MAP.md`: `ARCHITECTURE.md` §8;
> ADRs `decisions/ADR-008`, `decisions/ADR-015`, `decisions/ADR-016`,
> `decisions/ADR-017`, `decisions/ADR-001`, `decisions/ADR-018`; domain
> `domain/game-model.md`, `domain/tactical-training.md`,
> `domain/game-library.md`; research `research/synchronization.md`.
>
> Feature 016 adds **optional** backup/sync above local persistence. It must
> not change the domain pipeline, must not gate any other feature, and the app
> must remain fully usable with sync disconnected (ADR-001, spec Constraint).
>
> This plan is organized as stages 1–8. Each stage lands with its own tests and
> a narrow gate; the full `## Execution policy` gate runs at the end.

---

## 1. Objective

Deliver the Feature-016 slice per the spec and its ADRs:

1. **Provider-independent sync abstraction** — a `SyncProvider` contract and a
   provider registry, so Dropbox is one adapter and future providers need no
   domain change (ADR-008).
2. **Dropbox provider** — App-Folder scoped, OAuth2 PKCE (no client secret),
   refresh tokens in IndexedDB, the V1 endpoints from
   `research/synchronization.md` §3, with `rev`/`content_hash` encapsulated in
   the adapter (ADR-015).
3. **Push / pull / merge** — the ADR-016 gzipped single-file envelope and the
   ADR-017 JSON-level, record-by-record merge with `updatedAt` last-write-wins
   and `deviceId` tie-break, plus Dropbox `rev` optimistic concurrency and the
   bounded 409 retry.
4. **Deletion propagation** — tombstones for the user-deletable top-level
   entities (`games`, `trainingSets`) that trigger the existing ownership
   cascades on every device; the FEN-keyed engine cache is never synced
   (ADR-018) and never purged by a tombstone (spec "Deletion & derived state").
5. **Offline queue / status / recovery** — a persisted pending/dirty state that
   survives offline periods, a `SyncStatus` surface in the header and Settings,
   and the ADR-017 timestamped remote backup plus a restore path.
6. **Derived-field safety** — `timeControlModel` / `normalizedTimeControl` are
   recomputed from the verbatim `timeControl` + `source` on every merge; remote
   values are never trusted (ADR-013, spec).

No new domain pipeline rules, no schema change to existing semantics (only
additive tables/fields), no engine work, no new UI route beyond the Settings
panel and a header indicator.

---

## 2. Scope

### In scope

- `src/domain/sync/` — pure envelope, collection registry, merge, content hash,
  settings allowlist. No React, Dexie, network or Worker imports.
- `src/infrastructure/sync/` — `SyncProvider` contract, Dropbox adapter + PKCE,
  gzip, snapshot export/import gateway, sync engine, scheduler, browser wiring.
- `src/infrastructure/db/` — schema v12 (`syncState`, `syncTombstones`,
  `syncBackups`), the three new repositories, `updatedAt` on the two mutable
  synced rows, tombstones written by the two deletion paths.
- `src/components/sync/`, `src/hooks/useSync.ts`, `SettingsPage` panel, header
  indicator.
- **Local export/import (G4, owner decision)** — a provider-free *Export backup*
  (download the gzip sync envelope) and *Import backup* (pick a previously
  exported envelope, validate + merge through the same path, reload), reusing
  the envelope/merge core. Works with no provider configured.
- `src/config/app-config.ts`, `src/vite-env.d.ts`, `.env.example`, `README.md`
  for the Dropbox App Key (public, never a secret).
- One runtime dependency: `dropbox` (official SDK, MIT) behind the adapter, at
  the latest stable release. A thin `fetch` client is the documented fallback
  (see §10 and Risks).

### Out of scope (owned elsewhere or explicitly deferred)

- Incremental/delta sync, CRDT, multi-user editing (ADR-016/017 defer).
- Client-side encryption (research §7 recommends against V1).
- Syncing `positionAnalysisCache` (ADR-018), `importJobs` (transient job state),
  or derived per-game insights/filter/search/selection state (spec).
- Changing engine, analysis, detection, puzzle-generation or statistics logic.

---

## 3. Existing code to reuse (verified anchors)

### Persistence and composition

- `src/infrastructure/db/database.ts:34-82` — `ChessRemedyDatabase`, the
  ordered `applyVnSchema(this)` chain and the `PERSISTENCE_SCHEMA_VERSION`
  guard (`:76-81`). Extend both for v12.
- `src/infrastructure/db/schema/index.ts:1-20` — schema applier barrel.
- `src/infrastructure/db/schema/v11.ts:29-48` — precedent for a data-only
  version that repeats a store definition solely to force the one-time
  upgrade.
- `src/config/app-config.ts:11` — `PERSISTENCE_SCHEMA_VERSION`; `:14-28`
  `SETTINGS_KEYS`.
- `src/app/bootstrap.ts:22-28` — best-effort composition-root seam
  (precedent: `src/infrastructure/training/legacy-auto-set-cleanup.ts:1-15`).
- `src/infrastructure/db/settings-repository.ts:1-31` — `SettingRow`
  (`key`/`value`/`updatedAt`) and the settings read/write seam.

### Deletion cascades (reuse, never duplicate)

- `src/infrastructure/db/games-repository.ts:254-287` — `deleteGames` cascade:
  analyses, analysis jobs, summaries, candidates, puzzles, attempts (by derived
  puzzle id) and set-membership stripping. **This is the function a game
  tombstone must invoke on the receiving device.**
- `src/infrastructure/db/training-sets-repository.ts:130` — `delete(id)` (the
  set → cycles → attempts cascade) for a set tombstone.
- `src/infrastructure/db/attempts-repository.ts:78,136` —
  `deleteForPuzzleIds`.
- `src/infrastructure/db/training-cycles-repository.ts:64,131` —
  `deleteForSet`.

### Derived game fields (recompute on merge)

- `src/infrastructure/db/games-repository.ts:20-23,341` — the canonical
  `parseTimeControl` + `timeControlProfileForSource` call used at save time.
- `src/domain/chess/timeControl.ts` — `parseTimeControl`,
  `timeControlProfileForSource`, `TimeControl`.

### Provider / transport pattern to mirror

- `src/infrastructure/providers/types.ts:29-38` — `ProviderAdapter` contract
  style (stateless, injectable).
- `src/infrastructure/providers/transport.ts:12-49,91-141` — typed error codes
  and `fetchWithRetry`; a Dropbox transport should mirror this shape and accept
  an injected `FetchLike` (`:68`) for MSW.
- `src/infrastructure/providers/msw.test.ts:1-58` — the MSW node-env test
  pattern (`// @vitest-environment node`, `setupServer`,
  `onUnhandledRequest: 'error'`).
- `src/infrastructure/db/engine-cache-repository.ts:11` — explicit "never
  synced" contract to honor.

### UI seams

- `src/components/layout/AppShell.tsx:30-37` — header slot for the status
  indicator.
- `src/pages/SettingsPage.tsx:55-61` — the `SETTINGS_PLACEHOLDERS`
  "Synchronization" entry to replace; `:611-623` the render loop to remove it
  from.
- `src/hooks/useTheme.ts:38-76` — hook + `settingsRepository` pattern to mirror
  for `useSync`.

### Test infrastructure

- `src/test/setup.ts` — `fake-indexeddb/auto`, per-test DB reset, happy-dom.
- `src/infrastructure/db/schema/v10-migration.test.ts` / `v11-migration.test.ts`
  — the migration-test pattern (open a vN-1 Dexie, seed rows, reopen at vN,
  assert).
- `src/infrastructure/db/database.test.ts:14,29` — the `db.verno === 11`
  assertion to bump to 12.

---

## 4. Specification gaps and decisions required before implementation

The feature spec is intentionally terse and delegates to the ADRs. Four points
need an explicit, recorded decision. None is a contradiction; the plan states
the chosen resolution and flags the doc touch-up.

- **G1 — Tombstone collection vs ADR-016's envelope list.** ADR-016 lists
  `games, analysis, puzzles, trainingSets, trainingCycles, puzzleAttempts,
  settings`; the spec mandates tombstones. Resolution: add a top-level
  `tombstones` collection to the **version-1** envelope (purely additive). This
  extends, not breaks, ADR-016. *Action: update ADR-016's conceptual shape (or
  add a one-line note) to include `tombstones`.*
- **G2 — ADR-017's "all records carry `updatedAt`".** `MoveAnalysis`,
  `PuzzleRow` and `PuzzleAttemptRow` are immutable add-only records with a
  canonical creation timestamp (`analyzedAt`/`createdAt`/`endedAt`); adding a
  redundant field is churn. `PuzzleCandidateRow` and `TrainingCycleRow` are
  genuinely mutable and lack one. Resolution: the collection registry defines
  the effective merge timestamp; the two mutable collections gain a real
  additive `updatedAt` (v12). *Action: add a clarifying sentence to ADR-017's
  "Record-level merge" that immutable rows' creation timestamp is their
  `updatedAt`.*
- **G3 — "Offline queue".** With ADR-016's full-file snapshot sync, the queue is
  not per-record. Resolution: the queue is the persisted pending/dirty state
  plus the tombstone table (deletions are never lost), drained by the
  scheduler when back online. Documented in the code and plan.
- **G4 — export/import (included, owner decision).** Feature 016 includes a
  **local export/import** surface (PRODUCT §16). The sync envelope is the backup
  format: *Export backup* serializes + gzips the local leaf collections to a
  downloadable file; *Import backup* parses + validates a chosen envelope,
  merges it through the **same** `mergeCollection`/`mergeTombstones` path (a
  tombstone still wins), applies it (recomputing derived TC fields), and reloads
  the app. It requires **no provider** and is available whenever the local data
  exists. The ADR-017 conflict backup stays the automatic recovery artifact.

**Stop condition:** if the team wants literal `updatedAt` on every synced row
(G2), update the ADR/feature spec first; the rest of the plan is unaffected.

---

## 5. Files/modules to create or modify

### New — domain (pure)

| File | Responsibility |
| ---- | -------------- |
| `src/domain/sync/types.ts` | `SyncEnvelopeV1`, `SyncCollectionName`, `SyncTombstone`, `TombstoneKind`, `SyncStatus`, `DeviceId`, `RemoteFileMetadata`. |
| `src/domain/sync/collections.ts` | Leaf-collection registry: name, envelope group, `keyOf`, effective `updatedAtOf`, ownership. |
| `src/domain/sync/envelope.ts` | `SYNC_PAYLOAD_VERSION = 1`, `serializeEnvelope` (canonical ordering), `parseEnvelope`, versioned `migrateEnvelope` registry, validation. |
| `src/domain/sync/merge.ts` | `mergeCollection`, `mergeTombstones`, `resolveAgainstTombstone` — pure, deterministic LWW. |
| `src/domain/sync/tombstone.ts` | `tombstoneId(kind, recordId)`, `makeTombstone`. |
| `src/domain/sync/contentHash.ts` | `dropboxContentHash(bytes)` (4 MiB block SHA-256 rule). |
| `src/domain/sync/settings.ts` | `SYNCED_SETTINGS_KEYS` allowlist + `selectSyncedSettings` / `excludeSyncSecrets`. |
| `src/domain/sync/index.ts` | Barrel. |

### New — infrastructure

| File | Responsibility |
| ---- | -------------- |
| `src/infrastructure/sync/types.ts` | `SyncProvider`, `SyncProviderError` + codes, `RemoteFileMetadata`, `SyncRunResult`, `SyncStatusSnapshot`. |
| `src/infrastructure/sync/gzip.ts` | `gzipBytes`/`gunzipBytes` over `CompressionStream`/`DecompressionStream` (injectable for node tests). |
| `src/infrastructure/sync/snapshot.ts` | `SyncCollectionsGateway`: read/apply the leaf collections from Dexie; canonical export; merge application incl. TC recompute. |
| `src/infrastructure/sync/sync-service.ts` | `SyncService`: push/pull/merge/409-retry/backup, status emission, connect/disconnect/restore. |
| `src/infrastructure/sync/sync-scheduler.ts` | Triggers: startup, `online`, `visibilitychange`, interval poll; best-effort, never throws. |
| `src/infrastructure/sync/browser.ts` | Memoised browser singleton (provider + repos + scheduler). |
| `src/infrastructure/sync/dropbox/dropboxClient.ts` | Thin typed client over the official `dropbox` SDK (injected `fetch`); maps errors to `SyncProviderError`. |
| `src/infrastructure/sync/dropbox/dropboxAuth.ts` | PKCE verifier/challenge, authorize URL, code exchange, refresh, token persistence via `syncStateRepository`. |
| `src/infrastructure/sync/dropbox/dropboxProvider.ts` | `SyncProvider` implementation: metadata/download/upload (update mode `rev`), backups. |
| `src/infrastructure/sync/dropbox/index.ts` | Barrel. |
| `src/infrastructure/sync/index.ts` | Barrel. |
| `src/infrastructure/db/sync-state-repository.ts` | Non-synced `syncState` rows (deviceId, tokens, rev, hashes, pending, status, lastError). |
| `src/infrastructure/db/tombstones-repository.ts` | `syncTombstones` CRUD + merge helpers. |
| `src/infrastructure/db/sync-backups-repository.ts` | Non-synced `syncBackups` rows (timestamped remote payloads). |
| `src/infrastructure/db/schema/v12.ts` | v12 stores + backfill. |

### New — presentation

| File | Responsibility |
| ---- | -------------- |
| `src/components/sync/SyncStatusIndicator.tsx` + `.module.css` | Header indicator (hidden when not configured). |
| `src/components/sync/SyncSettingsPanel.tsx` + `.module.css` | Connect/disconnect, status, sync now, OAuth callback, backup list/restore, **and local Export/Import backup (G4, no provider required)**. |
| `src/components/sync/index.ts` | Barrel. |
| `src/hooks/useSync.ts` | Subscribes to the sync service, exposes status/actions. |

### Modified

| File | Change |
| ---- | ------ |
| `src/infrastructure/db/database.ts` | `syncState`/`syncTombstones`/`syncBackups` tables, `applyV12Schema`, version guard 12. |
| `src/infrastructure/db/schema/index.ts` | Export `applyV12Schema`. |
| `src/config/app-config.ts` | `PERSISTENCE_SCHEMA_VERSION = 12`; sync constants; settings keys if needed. |
| `src/domain/tactics/types.ts` | `RawCandidate.updatedAt` (required; set `= createdAt` on insert, bumped on status change). |
| `src/domain/training/cycleTypes.ts` | `TrainingCycleRow.updatedAt` (required; bumped on lifecycle change). |
| `src/infrastructure/db/candidates-repository.ts` | Set/bump `updatedAt` on put/status/rejection. |
| `src/infrastructure/db/training-cycles-repository.ts` | Set/bump `updatedAt` on create/updateStatus. |
| `src/infrastructure/db/games-repository.ts` | `deleteGames` writes `game` tombstones in the same transaction. |
| `src/infrastructure/db/training-sets-repository.ts` | `delete` writes a `trainingSet` tombstone in the same transaction. |
| `src/infrastructure/db/database.test.ts` | `verno` → 12. |
| Test-support factories for candidates/cycles (`src/domain/training/test-support.ts`, tactics test support) | Add `updatedAt`. |
| `src/app/bootstrap.ts` | Best-effort `startSyncScheduler()` when a provider is connected. |
| `src/components/layout/AppShell.tsx` | Mount `<SyncStatusIndicator />` in the header. |
| `src/pages/SettingsPage.tsx` | Remove the Synchronization placeholder; render `<SyncSettingsPanel />`. |
| `src/vite-env.d.ts` | `readonly VITE_DROPBOX_APP_KEY?: string`. |
| `package.json` | Add `dropbox` (latest stable). |
| `.env.example` (new), `README.md` | Document `VITE_DROPBOX_APP_KEY` + Dropbox redirect URI (no secret committed). |

---

## 6. Domain changes (`src/domain/sync/`)

All pure: no Dexie, React, Worker or `fetch`.

### 6.1 Envelope (ADR-016)

```ts
type SyncEnvelopeV1 = {
  version: 1;
  exportedAt: string;          // ISO-8601
  deviceId: string;            // stable per-device UUID
  collections: {
    games: GameRow[];
    analysis: {
      analyses: MoveAnalysis[];
      analysisJobs: AnalysisJob[];
      analysisSummaries: AnalysisSummaryRow[];
      puzzleCandidates: PuzzleCandidateRow[];
    };
    puzzles: PuzzleRow[];
    trainingSets: TrainingSetsRow[];
    trainingCycles: TrainingCycleRow[];
    puzzleAttempts: PuzzleAttemptRow[];
    settings: SettingRow[];
    tombstones: SyncTombstone[]; // G1: additive
  };
};
```

- `serializeEnvelope` sorts leaf collections and records by their canonical key
  so gzip bytes are deterministic (needed for content-hash comparison and
  reproducible tests).
- `parseEnvelope` rejects unknown `version`; `migrateEnvelope` applies versioned
  transforms in sequence (empty registry at v1, per ADR-016 Migration).

### 6.2 Collection registry

One entry per leaf array: `{ name, group, keyOf, updatedAtOf }`.

- `keyOf`:
  - `games` → `id`; `analysisJobs` → `id`; `analysisSummaries` → `analysisId`;
    `trainingSets` → `id`; `trainingCycles` → `id`; `settings` → `key`.
  - `analyses` → `` `${analysisId}:${ply}` ``.
  - `puzzleCandidates` → `` `${analysisId}:${sourcePly}` ``.
  - `puzzles` → `` `${sourceGameId}:${sourcePly}` `` (reuse `puzzleIdOf`).
  - `puzzleAttempts` → `` `${cycleId}:${puzzleId}:${presentationIndex}` ``.
- `updatedAtOf`:
  - stored `updatedAt` where present (`games`, `analysisJobs`,
    `analysisSummaries`, `trainingSets`, `puzzleCandidates`, `trainingCycles`,
    `settings`);
  - immutable creation timestamp otherwise (`analyses` → `analyzedAt`,
    `puzzles` → `createdAt`, `puzzleAttempts` → `endedAt`) — G2.

### 6.3 Merge (ADR-017)

```ts
mergeCollection<T>(local, remote, { keyOf, updatedAtOf }, tombstones, localDeviceId, remoteDeviceId)
```

- Match by `keyOf`; one-sided records accepted as-is.
- Both sides: newer `updatedAt` wins; tie → the lexicographically smaller of
  `{localDeviceId, remoteDeviceId}` wins (deterministic and convergent because
  both devices compare the same two ids).
- Tombstone rule: a record is dropped when a tombstone for its key exists with
  `deletedAt >= record.updatedAt`; when `record.updatedAt > deletedAt` the
  record is a recreation and the tombstone is discarded.
- `mergeTombstones` merges by `id` with the same timestamp/tie rule.
- `mergeSettings` special-cases the `settings` collection: only
  `SYNCED_SETTINGS_KEYS` cross the wire; auth/sync-state keys never do.

### 6.4 Content hash

`dropboxContentHash(bytes)`: split into 4 MiB blocks, SHA-256 each block,
concatenate the raw digests, SHA-256 the concatenation, hex-encode. Pure,
deterministic, unit-tested against the published example vectors.

---

## 7. Data-model changes (Dexie schema v12)

Additive only; no existing store definition changes semantics.

### 7.1 New stores

```
syncState:      '&key'                       // non-synced: deviceId, tokens, rev, hashes, pending, status
syncTombstones: '&id, kind, recordId, deletedAt'
syncBackups:    '&id, createdAt'             // non-synced: timestamped remote payloads
```

- `syncState` holds: `deviceId`, `provider`, `refreshToken`/`accessToken` +
  expiry, `lastRemoteRev`, `lastRemoteContentHash`, `lastPushedHash`,
  `lastSyncedAt`, `pending`, `status`, `lastError`. **Never in the envelope.**
- `SyncTombstone` = `{ id, kind: 'game' | 'trainingSet', recordId, deletedAt,
  deviceId }`. Tombstones for derived rows (analyses/puzzles/attempts/cycles)
  are unnecessary: the game/set cascade removes them on every device.

### 7.2 Additive fields (backfilled by v12)

- `puzzleCandidates.updatedAt` (`RawCandidate.updatedAt`) — set `= createdAt` on
  insert, bumped by `updateStatus` / `updateRejected`.
- `trainingCycles.updatedAt` (`TrainingCycleRow.updatedAt`) — set `= startedAt`
  on create, bumped by `updateStatus`.

The v12 upgrade backfills both from `createdAt` / `startedAt`. Immutable rows
keep their existing creation timestamps (G2), so no other type changes.

### 7.3 Tombstone writes

- `DexieGamesRepository.deleteGames` (`games-repository.ts:254-287`) adds the
  `syncTombstones` table to its transaction and writes one `game` tombstone per
  id before/with the cascade.
- `DexieTrainingSetsRepository.delete` (`training-sets-repository.ts:130`) adds
  the `syncTombstones` table and writes one `trainingSet` tombstone.
- The tombstone write reads `deviceId` from `syncStateRepository` (lazily
  created). Tombstones are written even when sync is unconfigured, so a later
  connection propagates prior deletions.

---

## 8. Infrastructure changes

### 8.1 `SyncProvider` contract (provider-independent, ADR-008)

```ts
interface SyncProvider {
  readonly id: SyncProviderId;               // 'dropbox'
  readonly label: string;
  isConfigured(): boolean;
  isConnected(): Promise<boolean>;
  beginConnect(redirectUri: string): Promise<void>;   // navigate/redirect
  completeConnect(callback: URLSearchParams): Promise<void>;
  disconnect(): Promise<void>;
  getMetadata(): Promise<RemoteFileMetadata | null>;   // { rev, contentHash, size, serverModified }
  download(): Promise<Uint8Array>;
  upload(bytes: Uint8Array, opts: { rev: string | null; autorename?: boolean }): Promise<RemoteFileMetadata>;
  listBackups?(): Promise<RemoteBackupInfo[]>;
}
```

- `SyncProviderError` codes mirror `ProviderHttpErrorCode`
  (`transport.ts:12-19`) plus `conflict` and `auth`.
- `rev`/`content_hash` never leak past the adapter (ADR-017).

### 8.2 Dropbox adapter (ADR-015)

- Path: `/Apps/ChessRemedy/sync.json.gz`; `Content-Type: application/gzip`.
- OAuth2 PKCE (Web Crypto): `code_verifier` in `sessionStorage`, `S256`
  challenge, `token_access_type=offline`, refresh on expiry; tokens persisted in
  `syncState` (IndexedDB), never in `settings`/the envelope.
- Endpoints: `/oauth2/token`, `/2/files/get_metadata`, `/2/files/download`,
  `/2/files/upload`; polling only (no longpoll — research §8 CORS caveat).
- Backups: `sync.backup-<ISO>.json.gz` in the same App Folder, written only on
  conflict exhaustion (ADR-017 step 4e).
- The official `dropbox` SDK is isolated to
  `src/infrastructure/sync/dropbox/`; the SDK's `fetch` is injectable so MSW
  intercepts it in Node tests.
- **Fallback:** if the SDK cannot bundle cleanly under Vite (see Risks), replace
  `dropboxClient.ts` with a thin `fetch` client over the same four endpoints and
  drop the dependency — the `SyncProvider` boundary is unchanged.

### 8.3 Snapshot gateway and engine

- `SyncCollectionsGateway` reads each leaf collection via its Dexie table and
  applies merges back. For `games` it runs
  `parseTimeControl(row.timeControl, timeControlProfileForSource(row.source))`
  on every merged row before put (ADR-013; spec). It never reads/writes
  `positionAnalysisCache`, `syncState` or `syncBackups`.
- `SyncService.syncNow()`:
  1. `localBytes = gzip(serializeEnvelope(exportLocal()))`; `localHash =
     dropboxContentHash(localBytes)`.
  2. `remote = provider.getMetadata()`.
  3. If no remote → create upload; store `rev`/`contentHash`/`lastPushedHash`.
  4. If `localHash === lastPushedHash && remote.contentHash === lastPushedHash`
     → up to date.
  5. If only local changed → update upload with `remote.rev`.
  6. If only remote changed → download, `parseEnvelope` + `migrateEnvelope`,
     merge, apply, then record `rev`/hashes.
  7. If both changed → download/merge/apply, export merged, update upload.
  8. HTTP 409 → refetch `rev`, re-merge, retry (max 3). After 3 failures:
     persist the remote payload in `syncBackups` (and optionally upload
     `sync.backup-<ts>.json.gz`), then create the merged file as a new upload.
  9. Apply tombstones via `deleteGames` / `trainingSetsRepository.delete` after
     record upserts, so deletion wins in the round and cascades everywhere.
- `SyncService` emits `SyncStatusSnapshot` (`disabled | disconnected | idle |
  syncing | offline | error | conflict`) and persists the last status in
  `syncState` for cross-session display. Every failure is caught and surfaced;
  sync never blocks a UI action.

### 8.4 Scheduler / offline queue

- `sync-scheduler.ts` triggers on: bootstrap (if connected), `online`,
  `visibilitychange`→visible, and a debounced interval (default 5 min, per
  research §8 recommendation). Each trigger re-checks the local hash; the
  persisted `pending` flag + tombstones are the durable queue.
- `bootstrap.ts` starts the scheduler best-effort (swallow all rejections, like
  the legacy cleanup) only when a provider reports connected.

### 8.5 Config

- `VITE_DROPBOX_APP_KEY` (public app key only) in `vite-env.d.ts` and
  `.env.example`; no `client_secret` (PKCE). Redirect URI documented as the
  deployed origin + `/settings`.
- Sync constants (path, interval, payload version, retry counts) live in the
  sync module; `PERSISTENCE_SCHEMA_VERSION` stays in `app-config.ts`.

---

## 9. UI changes

- **Header** (`AppShell.tsx:30-37`): `<SyncStatusIndicator />` next to
  `ThemeToggle`; renders nothing when no provider is configured/connected.
  States: syncing (spinner + `aria-live` text), idle/last-synced, offline,
  error (actionable link to Settings), conflict. Never the only affordance —
  Settings always exposes the same actions.
- **Settings** (`SettingsPage.tsx`): replace the Synchronization placeholder
  (`:55-61`, render `:611-623`) with `<SyncSettingsPanel />`:
  - Not configured: explanation + "Connect Dropbox" (starts PKCE redirect).
  - Connected: account label (optional `account_info.read`), last-synced,
    "Sync now", "Disconnect", current status/error, and the backup list with
    "Restore" / "Download".
  - OAuth return: the panel detects `?code=` on mount, calls
    `provider.completeConnect`, cleans the URL, and shows the result.
  - All controls keyboard/touch reachable, labelled, theme-aware; responsive at
    desktop/tablet/mobile; dark + light tokens reused.
- No new route is required; the Dropbox redirect targets `/settings`.

---

## 10. Dependencies

- **`dropbox`** — official Dropbox JavaScript SDK, MIT license (compatible with
  GPL-3.0-or-later, ADR-027), latest stable release at implementation time
  (`npm install dropbox@latest`; no version pin beyond the lockfile). Isolated
  to `src/infrastructure/sync/dropbox/`. Aligned with
  `research/synchronization.md` §8.
- **No other runtime dependency.** Gzip uses browser-native
  `CompressionStream`/`DecompressionStream` (ADR-016); PKCE uses Web Crypto; the
  content hash uses Web Crypto `crypto.subtle.digest`; HTTP uses the SDK's
  injectable `fetch`.
- **Fallback (dependency-free):** if the SDK does not bundle cleanly under Vite
  or introduces peer conflicts, stop and consult per the AGENTS "Execution
  policy"; the pre-approved alternative is a thin `fetch` Dropbox client over
  the same endpoints, requiring no new dependency. The `SyncProvider` boundary
  makes the swap local.
- No dependency change is needed for testing (Vitest/MSW already present).

---

## 11. Tests

Deterministic, network-free, fixture-separated.

### Domain (`src/domain/sync/*.test.ts`)

- `merge.test.ts` — newer-`updatedAt` wins; `deviceId` tie-break converges for
  both merge directions; one-sided records accepted; tombstone deletes a record;
  a recreation with a newer `updatedAt` beats the tombstone; settings allowlist
  excludes secrets.
- `envelope.test.ts` — canonical serialization is stable; parse rejects unknown
  versions; the migration registry composes.
- `contentHash.test.ts` — published Dropbox content-hash vectors (multi-block
  and sub-block).
- `collections.test.ts` — every leaf `keyOf`/`updatedAtOf` is total and
  deterministic; immutable rows fall back to their creation timestamp.

### Infrastructure

- `snapshot.test.ts` (fake-indexeddb) — export/import round-trip; TC fields are
  recomputed on merge and a stale remote category cannot reintroduce itself;
  cache/sync tables are never included.
- `sync-service.test.ts` — with an in-memory `SyncProvider` and fake-indexeddb:
  create upload; up-to-date no-op; push-only; pull-only; both-changed merge;
  409 retry then backup; offline → `offline` status; game tombstone invokes the
  cascade and leaves the engine cache intact.
- `dropboxProvider.test.ts` (`// @vitest-environment node` + MSW) — metadata
  404 → create; download; upload with `mode.update`; 409 → `conflict`; 429 →
  retry; malformed payload → `invalid-response`.
- `dropboxAuth.test.ts` (node env) — verifier/challenge S256, authorize URL
  includes `token_access_type=offline`, code exchange, refresh, token
  persistence, no secret in the URL/body.
- `sync-scheduler.test.ts` — triggers debounce and never throw.
- `sync-state/tombstones/backups-repository.test.ts` — CRUD + transaction
  participation with the deletion cascades.

### Schema

- `v12-migration.test.ts` — open at v11, seed a candidate and a cycle, reopen at
  v12, assert `updatedAt` backfilled and the three tables present; assert
  `PERSISTENCE_SCHEMA_VERSION === 12`.

### UI

- `SyncSettingsPanel.test.tsx` — disconnected/connected/error/conflict states,
  connect action, OAuth `?code=` handling and URL cleanup, backup restore, and
  the **local Export/Import** actions (export produces a downloadable gzip
  envelope; import merges a chosen envelope and respects a tombstone).
- `SyncStatusIndicator.test.tsx` — hidden when unconfigured; `aria-live` text
  per status.
- Update `database.test.ts` (`verno` 12) and any factory-dependent tests.

### Browser (Playwright, when Chromium is available)

- One smoke: Settings renders the Synchronization panel in the disconnected
  state with no console errors; the app remains fully usable.

---

## 12. Migration considerations

- **Schema v12 is additive**: three new stores + two backfilled fields. No
  existing table is dropped or reshaped; no engine cache change (ADR-018).
- `PERSISTENCE_SCHEMA_VERSION` 11 → 12; update the guard in
  `database.ts:76-81` and `database.test.ts:14,29`.
- v12 upgrade reads `puzzleCandidates`/`trainingCycles` once, sets the missing
  `updatedAt`, and `bulkPut`s; idempotent and safe on an already-migrated DB.
- **Payload versioning**: `SYNC_PAYLOAD_VERSION = 1`; reading clients reject
  unknown versions; the migration registry must contain a transform before a
  version 2 is ever published (ADR-016).
- **No destructive sync**: merge never deletes a local record except via a
  tombstone; a tombstone cascade reuses the existing game/set deletion paths.
- **OAuth token upgrade**: tokens live only in `syncState`; reconnecting is the
  recovery path for an invalidated token (ADR-015 consequence).
- **Rollback**: disabling sync is always safe; the three sync tables can be
  cleared without touching domain data. The v12 fields are ignored by older
  code paths.

---

## 13. Risks

1. **Dropbox SDK bundling/peer risk under Vite** (known browser-bundler
   friction). Mitigation: adapter isolation + documented `fetch` fallback; if it
   cannot bundle cleanly, consult per the Execution policy before forcing.
2. **Tombstone resurrection ordering** — a remote set update that re-adds a
   puzzle from a deleted game. Mitigation: apply tombstones after upserts so the
   cascade wins in the round; a defensive set-membership filter against existing
   puzzles can be added if a real conflict is observed. Documented V1 limit.
3. **`updatedAt` semantics for immutable rows (G2)** — a reviewer may want
   literal fields. Mitigation: registry isolates the rule; adding fields later
   is mechanical.
4. **Canonical serialization drift** — non-deterministic JSON ordering would
   defeat content-hash comparison. Mitigation: sorted keys/records + a
   determinism test.
5. **Analysis-identity replacement vs record-level merge** — a forced re-run of
   the same `analysisId` replaces rows locally; per-ply merge could retain a
   stale remote ply. Mitigation: engine/config/version are part of the id and
   runs are deterministic; documented V1 limit (per-analysis unit merge is a
   future refinement).
6. **Secrets leakage** — an OAuth token must never enter the envelope or
   `settings`. Mitigation: dedicated `syncState`, settings allowlist, a
   "no-secret-in-snapshot" test.
7. **Large libraries** — full-file upload may be impractical at 100k+ games.
   Mitigation: ADR-016 defers incremental sync; surface payload size and fail
   gracefully; do not block the UI.
8. **OAuth redirect configuration** — requires a registered Dropbox app + exact
   redirect URI; no app key is committed. Mitigation: `.env.example` + README;
   the disconnected UI works without it.
9. **`CompressionStream` / Web Crypto availability in tests** — happy-dom may
   lack them. Mitigation: node-env tests for gzip/PKCE, injectable byte
   transforms.
10. **Sync must never degrade local-first use** — all engine/scheduler paths are
    best-effort and catch-all; a sync failure leaves status `error` and changes
    nothing else.

---

## 14. Acceptance criteria

1. Two devices (or two in-memory providers over the same remote) synchronize the
   same user's data **without a ChessRemedy backend**, per ADR-016/017.
2. Push, pull, conflict detection, 409 retry (max 3) and timestamped backup
   behave exactly as ADR-017 specifies.
3. Deletions propagate as tombstones: deleting a game on one device removes its
   analyses, candidates, puzzles, attempts and set membership everywhere; the
   FEN-keyed engine cache is untouched.
4. `timeControlModel`/`normalizedTimeControl` are recomputed from `timeControl`
   + `source` on merge; a stale remote category is never trusted (ADR-013).
5. The engine cache, `syncState`, `syncBackups`, OAuth tokens, import jobs,
   filter/search/selection state and derived insights are **never** synced.
6. The app is fully usable with sync disconnected or failing; sync status is
   visible in the header and Settings; recovery/restore works.
7. No new domain pipeline rules; domain sync code is pure; schema v12 is
   additive and idempotent.
8. The full `## Execution policy` gate passes with no warnings or errors.
9. **Local export/import (G4):** *Export backup* produces the gzip envelope with
   no provider configured; *Import backup* validates and merges a previously
   exported envelope through the canonical merge path (tombstones respected),
   recomputes derived TC fields, and leaves the app usable.

---

## 15. Verification commands

Narrow first, then the full gate (see AGENTS "Verification"; load the
`verify-gate` skill for the runbook).

```bash
# Stage 1–2 (domain + schema)
npx vitest run src/domain/sync src/infrastructure/db/schema/v12-migration.test.ts

# Stage 3–6 (infrastructure + repositories)
npx vitest run src/infrastructure/sync src/infrastructure/db/sync-state-repository.test.ts \
  src/infrastructure/db/tombstones-repository.test.ts \
  src/infrastructure/db/sync-backups-repository.test.ts

# Stage 7 (UI)
npx vitest run src/components/sync src/pages/SettingsPage.test.tsx src/components/layout/AppShell.test.tsx

# Full gate
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev          # smoke: no browser-console errors
npm run test:browser # when Chromium is available
npm audit
```

Manual multi-device smoke (documented in the PR): connect Dropbox on two
profiles, import/delete on one, sync, verify on the other; confirm the engine
cache is not transferred.

---

## 16. Implementation stages (incremental)

1. **Stage 1 — Domain sync core.** `types`, `collections`, `merge`,
   `envelope`, `tombstone`, `contentHash`, `settings` + unit tests. Gate:
   `npx vitest run src/domain/sync`.
2. **Stage 2 — Schema v12 + mutable-row `updatedAt`.** New stores, backfill,
   version bump, repository/factory updates, tombstone writes in the two
   deletion paths + migration/repo tests. Gate: schema + cascade tests.
3. **Stage 3 — Provider contract + gzip + snapshot gateway.** `SyncProvider`,
   `SyncProviderError`, gzip, `SyncCollectionsGateway` (TC recompute) + tests.
4. **Stage 4 — Dropbox adapter + PKCE.** Client, auth, provider, MSW tests.
5. **Stage 5 — Sync engine + state/backups.** Push/pull/merge/409/backup,
   `SyncService`, status emission + fake-provider tests.
6. **Stage 6 — Scheduler + bootstrap wiring.** Offline/poll triggers, best-effort
   startup + tests.
7. **Stage 7 — UI.** `useSync`, status indicator, Settings panel, OAuth return,
   backup restore, **local Export/Import backup (G4)** + component tests; bump
   `database.test.ts`.
8. **Stage 8 — Docs + full gate.** `.env.example`/README, spec/ADR touch-ups
   from §4 (G1/G2), then the complete `## Execution policy` gate.
