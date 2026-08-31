# Dropbox Synchronization for ChessRemedy

## Question

How should ChessRemedy implement optional cloud synchronization using Dropbox for a local-first React + TypeScript + Vite SPA, considering OAuth2 PKCE flow, file sync API, conflict handling, rate limits, client-side encryption, and browser SPA constraints?

## Sources

1. **Dropbox OAuth Guide** - https://developers.dropbox.com/oauth-guide
2. **Dropbox JavaScript SDK** - https://github.com/dropbox/dropbox-sdk-js (v10.46.0, MIT license, 131k weekly downloads)
3. **Dropbox PKCE Browser Example** - https://github.com/dropbox/dropbox-sdk-js/tree/main/examples/javascript/pkce-browser
4. **Dropbox API HTTP Documentation** - https://www.dropbox.com/developers/documentation/http/documentation
5. **Dropbox Content Hash Specification** - https://www.dropbox.com/developers/reference/content-hash
6. **Dropbox Detecting Changes Guide** - https://developers.dropbox.com/detecting-changes-guide
7. **Dropbox Performance Guide** - https://developers.dropbox.com/dbx-performance-guide
8. **Dropbox Scoped Apps Announcement** - https://dropbox.tech/developers/now-available--scoped-apps-and-enhanced-permissions
9. **Dropbox API Spec (files.stone)** - https://github.com/dropbox/dropbox-api-spec/blob/main/files.stone
10. **MDN Web Crypto API** - https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
11. **RFC 7636 (PKCE)** - https://datatracker.ietf.org/doc/html/rfc7636

## Findings

### 1. Dropbox OAuth2 PKCE Flow for Browser SPAs

**Supported and recommended.** Dropbox explicitly recommends PKCE for browser SPAs. The SDK supports it natively.

**Flow:**
1. App generates `code_verifier` (43-128 chars, `[0-9a-zA-Z\-\.\_\~]`)
2. App computes `code_challenge = base64url(SHA256(code_verifier))`
3. User redirected to: `https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&code_challenge=CHALLENGE&code_challenge_method=S256&token_access_type=offline`
4. User authorizes, redirected back with `code` query parameter
5. App exchanges code for tokens: POST to `https://api.dropboxapi.com/oauth2/token` with `code`, `code_verifier`, `grant_type=authorization_code`, `client_id=APP_KEY`

**Token lifecycle:**
- **Access token**: Short-lived (typically ~4 hours, exact value in `expires_in` response)
- **Refresh token**: Long-lived, returned when `token_access_type=offline` is specified
- **Refresh flow**: POST to `/oauth2/token` with `grant_type=refresh_token`, `refresh_token`, `client_id=APP_KEY`

**Token storage:**
- Refresh token must persist across sessions (IndexedDB via Dexie recommended)
- Access token can be held in memory during session
- `code_verifier` must be stored temporarily (sessionStorage) during OAuth redirect

**CORS:** Dropbox API endpoints (`api.dropboxapi.com`, `content.dropboxapi.com`) support CORS. The longpoll endpoint (`notify.dropboxapi.com`) has CORS issues in some browsers; polling-based change detection is safer for V1.

**Important:** No `client_secret` is needed for PKCE flows. Only `client_id` (App Key) is used.

### 2. App Folder vs Full Dropbox

**Recommendation: App Folder**

| Aspect | App Folder | Full Dropbox |
|--------|-----------|--------------|
| Access scope | `/Apps/ChessRemedy/` only | Entire Dropbox |
| User trust | Higher (limited scope) | Lower (full access) |
| Approval process | Easier | Requires justification |
| Data isolation | Natural | Must manage paths |
| User data risk | Minimal | Could accidentally access personal files |

**App Folder** is appropriate for V1 because:
- ChessRemedy only needs to sync its own data
- Least-privilege principle (AGENTS.md: "Prefer local processing")
- Dropbox production approval is easier for limited-scope apps
- Users are more comfortable granting limited access
- Natural path isolation: `/Apps/ChessRemedy/sync.json`

**Required scopes:**
- `files.content.read` - Download sync files
- `files.content.write` - Upload sync files
- `files.metadata.read` - List files, check revisions
- `account_info.read` - Optional, for user identification

### 3. API Endpoints Needed for V1 Sync

**Authentication:**
- `POST /oauth2/token` - Exchange code for tokens, refresh tokens

**File Operations:**
- `POST /2/files/upload` - Upload files up to 150 MB
- `POST /2/files/upload_session/start` - Start large file upload
- `POST /2/files/upload_session/append_v2` - Append to upload session
- `POST /2/files/upload_session/finish` - Finish upload session
- `POST /2/files/download` - Download file content
- `POST /2/files/get_metadata` - Get file metadata (rev, content_hash)

**Folder Operations:**
- `POST /2/files/list_folder` - List folder contents
- `POST /2/files/list_folder/continue` - Paginate results
- `POST /2/files/list_folder/get_latest_cursor` - Get cursor for change detection
- `POST /2/files/list_folder/longpoll` - Real-time change notifications (CORS issues, use polling for V1)

**File Metadata Fields:**
- `rev` - Unique revision identifier (for optimistic concurrency)
- `content_hash` - SHA-256 based hash (for data integrity)
- `server_modified` - Last modification timestamp
- `client_modified` - Client-provided timestamp
- `size` - File size in bytes

### 4. Rate Limits and Handling Strategy

**Dropbox does not publish exact rate limits**, but:

- Approximate: 1,200-2,000 requests per minute per user
- Rate limits are per-user, not per-app
- HTTP 429 response with `Retry-After` header indicates rate limiting
- Rate limited requests count against limits (don't retry immediately)

**Handling strategy for ChessRemedy:**
1. **Respect Retry-After header** - Wait specified seconds before retry
2. **Exponential backoff** - If no header, use exponential backoff (1s, 2s, 4s, 8s...)
3. **Batch operations** - Use `upload_session/finish_batch` for multiple files
4. **Debounce sync triggers** - Don't sync on every change, batch changes
5. **Full upload only when needed** - Use `content_hash` to detect changes
6. **Implement request queuing** - Sequential API calls, not parallel bursts

### 5. Conflict Detection and Resolution

**Dropbox provides:**
- **Rev-based optimistic concurrency**: Upload with `mode: { ".tag": "update", "rev": "..." }`
  - If rev matches current server rev → upload succeeds
  - If rev doesn't match → conflict error (HTTP 409)
- **Content hash verification**: `content_hash` field to verify data integrity
- **Autorename**: `autorename: true` creates "(conflicted copy)" files on conflict

**Conflict resolution strategy for ChessRemedy:**

**V1: Last-write-wins with conflict detection**

1. On sync, get remote `rev` and `content_hash`
2. Compare local `content_hash` with remote `content_hash`
3. If identical → no sync needed
4. If different:
   a. Get remote file content
   b. Merge with local data (JSON-level merge of IndexedDB collections)
   c. Upload merged result with remote `rev` (optimistic concurrency)
   d. If 409 conflict → re-fetch remote, re-merge, retry (max 3 attempts)
   e. If still conflicting → create backup of remote, upload merged as new file

**Why JSON-level merge works for ChessRemedy:**
- Each record has a unique ID (game ID, puzzle ID, etc.)
- Collections are independent (games, analysis, puzzles, FSRS data)
- Merging is additive: new records from either side can be combined
- Conflicting updates to the same record are rare (single-user, multi-device)

**Long-term consideration:** Operational Transform or CRDT for finer-grained conflict resolution, but likely unnecessary for V1.

### 6. File Format and Sync Strategy

**File format: JSON with metadata envelope**

```json
{
  "version": 1,
  "exportedAt": "2026-08-27T12:00:00Z",
  "deviceId": "uuid-of-device",
  "collections": {
    "games": { ... },
    "analysis": { ... },
    "puzzles": { ... },
    "fsrsCards": { ... },
    "settings": { ... }
  }
}
```

**Compression: Yes, use gzip**
- JSON is highly compressible (70-90% reduction typical)
- Use `CompressionStream` API (browser native, supported in modern browsers)
- Dropbox accepts `Content-Type: application/gzip` uploads
- Reduces upload/download time and bandwidth

**Sync strategy: Full file upload**
- ChessRemedy data is typically small (< 10 MB for most users)
- Full upload is simpler and more reliable than incremental
- `content_hash` comparison avoids unnecessary uploads
- Incremental sync adds complexity with minimal benefit for V1

**File size considerations:**
- 150 MB limit for single upload (more than sufficient)
- Typical chess data: 1,000 games ≈ 1-5 MB (compressed JSON)
- Upload session not needed for V1 (files under 150 MB)

### 7. Client-Side Encryption Feasibility

**Technically feasible but not recommended for V1.**

**Implementation would use:**
- Web Crypto API: `crypto.subtle.encrypt()` with AES-GCM-256
- PBKDF2 for key derivation from user password (310,000+ iterations)
- Random 12-byte IV per encryption
- Salt stored alongside encrypted data

**Trade-offs:**

| Aspect | Without Encryption | With Encryption |
|--------|-------------------|-----------------|
| Security | Dropbox sees JSON data | Dropbox sees ciphertext |
| Usability | No password needed | User must enter password |
| Recovery | Dropbox can help recover | Lost password = lost data |
| Complexity | Simple | Key management, IV handling |
| Performance | Minimal overhead | 10-50ms per sync operation |
| Cross-device | Automatic | Must enter password on each device |

**Why not for V1:**
1. Adds significant UX friction (password entry on every device)
2. Key management complexity (key derivation, storage, recovery)
3. Dropbox already provides encryption at rest and in transit
4. ChessRemedy data is not highly sensitive (chess games, not financial data)
5. Can be added later as optional enhancement

**If added later:**
- Encrypt entire JSON payload before upload
- Store derived key in IndexedDB (not localStorage)
- Provide password recovery mechanism (backup codes)
- Use Web Crypto API (already required for PKCE)

### 8. Browser SPA Support

**Dropbox JavaScript SDK works in browsers:**
- npm package: `dropbox` (v10.46.0, MIT license)
- ES module, CommonJS, and browser bundle available
- Requires: `Promise`, `fetch`, `TextEncoder`, Web Crypto API (for PKCE)
- Works in Web Workers

**OAuth flow options:**
1. **Redirect-based (recommended)**: User leaves app, authorizes on Dropbox, redirected back
2. **Popup-based**: Open popup window for authorization (may be blocked by browsers)

**Recommendation: Redirect-based PKCE**
- More reliable across browsers
- Better mobile support
- No popup blocker issues
- Standard OAuth pattern

**CORS considerations:**
- Main API endpoints support CORS
- Longpoll endpoint (`notify.dropboxapi.com`) has CORS issues
- For V1: Use periodic polling instead of longpoll
- SDK handles CORS headers automatically

## Limitations

1. **Exact rate limits unknown** - Dropbox does not publish exact numbers; must handle 429 errors gracefully
2. **Longpoll CORS issues** - Real-time change detection may not work reliably in all browsers; polling is safer
3. **No server-side webhook support** - Without a backend, cannot receive push notifications; must poll
4. **Token expiry** - Access tokens expire; refresh flow must be implemented correctly
5. **Offline changes** - If device is offline for extended period, large sync may be needed on reconnect
6. **Data size** - Very large chess libraries (100k+ games) may hit practical limits; need to consider pagination
7. **Dropbox API changes** - API may evolve; pin SDK version and monitor deprecations

## Recommendation

### V1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ChessRemedy SPA                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │   IndexedDB  │◄──►│  Sync       │◄──►│  Dropbox    │ │
│  │   (Dexie)    │    │  Service    │    │  Adapter    │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│                           │                    │        │
│                           │                    │        │
│                    ┌──────┴──────┐      ┌──────┴──────┐ │
│                    │  Merge      │      │  OAuth2     │ │
│                    │  Strategy   │      │  PKCE Flow  │ │
│                    └─────────────┘      └─────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **OAuth2 PKCE with redirect flow** - No client secret needed, secure, well-supported
2. **App Folder permission** - Least privilege, easier approval, natural isolation
3. **Full JSON file sync** - Simple, reliable, sufficient for chess data sizes
4. **Gzip compression** - Reduce bandwidth, use browser-native CompressionStream
5. **Content-hash based change detection** - Avoid unnecessary uploads
6. **Rev-based optimistic concurrency** - Detect and resolve conflicts
7. **JSON-level merge** - Combine changes from multiple devices
8. **Polling for changes** - Avoid longpoll CORS issues; poll every 5-10 minutes
9. **No encryption in V1** - Add later as optional enhancement
10. **Token storage in IndexedDB** - Secure, persistent, works offline

### Implementation Components

1. **DropboxAdapter** - Wraps Dropbox SDK, handles OAuth, token refresh
2. **SyncService** - Orchestrates sync operations, change detection, conflict resolution
3. **MergeStrategy** - JSON-level merge of IndexedDB collections
4. **ConflictResolver** - Handles 409 conflicts, retry logic
5. **SyncScheduler** - Debounces sync triggers, manages polling interval

## Impact on ChessRemedy

### Positive
- Users can sync data across devices (key V1 feature)
- No backend server required (local-first architecture preserved)
- Offline-first with optional sync (core principle maintained)
- Dropbox provides reliable storage and versioning

### Implementation Effort
- **Medium complexity** - Well-documented APIs, working SDK examples
- **Estimated 2-3 weeks** for V1 sync feature
- **Testing** - Requires manual testing with multiple devices

### Dependencies
- `dropbox` npm package (official SDK)
- No additional dependencies required
- Web Crypto API (already available in modern browsers)

### Architecture Decisions Required
1. ADR-008: Confirm Dropbox as sync provider (recommended) — Accepted.
2. ADR-015: App Folder vs Full Dropbox (recommend App Folder) — Accepted.
3. ADR-016: Sync file format (recommend JSON with metadata envelope) — Accepted.
4. ADR-017: Conflict resolution strategy (recommend JSON-level merge) — Accepted.

## Open Questions

1. **Sync frequency**: How often should automatic sync occur? (Recommend: on significant change + every 5 minutes when active)
2. **Initial sync**: Should first sync upload entire database or prompt user? (Recommend: upload entire database)
3. **Multi-account**: Should users be able to link multiple Dropbox accounts? (Recommend: single account for V1)
4. **Selective sync**: Should users choose which data to sync? (Recommend: all data for V1)
5. **Sync status UI**: How to display sync status, conflicts, errors? (Recommend: subtle indicator in header)
6. **Data migration**: How to handle schema changes in sync file format? (Recommend: version field + migration functions)
7. **Delete handling**: How to sync deletions across devices? (Recommend: soft delete with tombstone records)
8. **Performance impact**: What is acceptable sync latency for user experience? (Recommend: < 5 seconds for typical sync)
