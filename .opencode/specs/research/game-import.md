# Game Import from Chess.com and Lichess

## Question

What are the current (2026) mechanisms for retrieving a user's games from Chess.com and Lichess from a browser-based SPA without a backend server?

## Sources

1. Chess.com Published-Data API (PubAPI) - https://www.chess.com/news/view/published-data-api
2. Chess.com Help Center - https://support.chess.com/en/articles/9650547-what-is-the-pubapi-and-how-do-i-use-it
3. Lichess API Documentation - https://lichess.org/api
4. Lichess API Examples - https://github.com/lichess-org/api/tree/master/example
5. Lichess API Tips - https://lichess.org/page/api-tips
6. Shipapis health check - https://shipapis.dev/api/chess-com
7. Lichess GitHub Issue #6 (CORS) - https://github.com/lichess-org/api/issues/6

## Findings

### Chess.com

#### API Base URL and Version

- Base URL: `https://api.chess.com/pub`
- No versioning in URL path
- Returns JSON-LD format (JSON with linked data contexts)

#### Endpoints Needed for Game Import

| Endpoint | URL Pattern | Purpose |
|----------|-------------|---------|
| Player Profile | `/pub/player/{username}` | Verify player exists, get player_id |
| Available Archives | `/pub/player/{username}/games/archives` | List of monthly archive URLs |
| Monthly Archive (JSON) | `/pub/player/{username}/games/{YYYY}/{MM}` | All games for a month (JSON with PGN embedded) |
| Monthly Archive (PGN) | `/pub/player/{username}/games/{YYYY}/{MM}/pgn` | All games for a month (raw PGN) |

#### Authentication Requirements

- **No authentication required** for public data
- API is keyless and read-only
- Private data (game chat, conditional moves) not available via PubAPI
- For authenticated access (private games), Chess.com requires filling out a developer form

#### Rate Limits

- **Serial access rate is unlimited** - if you always wait for the previous response before making the next request
- Parallel requests may be blocked with `429 Too Many Requests`
- No fixed published cap on requests per minute
- Recommended: Include a recognizable User-Agent header with contact information
- Data refreshes at most once every 12-24 hours

#### Pagination

- Games are organized by month: `/games/{YYYY}/{MM}`
- Each monthly archive contains all games for that month
- To get all games: fetch archive list, then fetch each month sequentially
- No cursor-based pagination needed

#### CORS Support

- **CORS is enabled** - multiple sources confirm this
- Shipapis: "Chess.com returns CORS headers over HTTPS, so front-end code can fetch it directly with no backend proxy"
- GreatAPIs: "CORS: Enabled - Callable directly from browser JavaScript"
- Public-API.org: Confirms CORS support
- JSONP callback support available as fallback (`?callback=functionName`)

#### Response Format

- JSON-LD (JSON with linked data contexts) for most endpoints
- Raw PGN for `/pgn` endpoint
- Game objects contain embedded PGN string in JSON responses
- ETag and Last-Modified headers for caching

#### Known Limitations

- Data may be up to 12-24 hours stale
- ~3% of players may still use old v2 website, causing data currency issues
- No access to private games, game chat, or conditional moves
- No real-time game data (only finished games in archives)
- No bulk download endpoint beyond monthly archives

#### Security Considerations

- No tokens to store - completely public API
- No OAuth flow needed for public game data
- User-Agent header should include contact info to avoid blocks

---

### Lichess

#### API Base URL and Version

- Base URL: `https://lichess.org`
- OpenAPI 3.1.0 specification available
- All endpoints under `/api/`

#### Endpoints Needed for Game Import

| Endpoint | URL Pattern | Purpose |
|----------|-------------|---------|
| User Games Export | `/api/games/user/{username}` | Export all games of a user |
| Game by ID | `/api/game/{gameId}` | Export a specific game |
| User Profile | `/api/user/{username}` | Get user profile data |
| Account (authenticated) | `/api/account` | Get authenticated user's account |

#### Authentication Requirements

**For public games:**
- No authentication required
- Can fetch any user's public games without authentication

**For private games or higher rate limits:**
- **Personal Access Token**: Manually generated at https://lichess.org/account/oauth/token
- **OAuth2 with PKCE**: Fully supported for browser-based apps
  - Supports unregistered/public clients (no client secret needed)
  - Only S256 code challenge method accepted
  - Access tokens are long-lived (~1 year)
  - No refresh tokens supported
  - Official example: https://github.com/lichess-org/api/tree/master/example/oauth-app

#### Rate Limits

- **Only make one request at a time**
- If you receive HTTP 429, wait at least one minute before retrying
- Authenticated requests: up to 200 requests per 10 seconds
- Unauthenticated requests: lower limits (not precisely documented)
- Complex rate limiting strategies protect against DDoS
- No fixed per-endpoint limits published

#### Pagination

- Cursor-based streaming for game export
- Use `since` and `until` parameters (timestamps in milliseconds)
- Use `max` parameter to limit number of games
- NDJSON streaming response - one game per line
- Can filter by date range, opponent, color, rated/casual, game type

#### CORS Support

- **CORS is enabled** for GET requests
- GitHub Issue #6 confirmed CORS headers are present on `/games/export`
- Lichess API UI (https://lichess.org/api/ui) is a browser-based client-side app
- Official OAuth app example is fully client-side
- Forum posts confirm browser access works

#### Response Format

- **PGN** (default): `Accept: application/x-chess-pgn`
- **NDJSON**: `Accept: application/x-ndjson` - one JSON game object per line
- **JSON**: `Accept: application/json` - for single game export
- Recommended for game export: NDJSON with `pgnInJson=true` for structured data
- Can include: moves, clocks, evaluations, opening names

#### Known Limitations

- Private games require authentication token
- Rate limits are complex and not precisely documented
- Large exports may take time due to streaming
- No refresh tokens for OAuth - users must re-authenticate after token expiry
- Variant openings may be included in standard game exports (issue #11170)

#### Security Considerations

- Personal access tokens should never be hardcoded or shipped in frontend bundles
- OAuth2 PKCE flow is recommended for multi-user apps
- Tokens can be stored in IndexedDB/localStorage after OAuth flow
- Tokens have broad permissions - treat as passwords
- Users can revoke tokens at any time

---

## CORS Analysis

### Chess.com

| Aspect | Status |
|--------|--------|
| CORS Headers Present | Yes |
| Access-Control-Allow-Origin | `*` (wildcard) |
| Preflight OPTIONS | Supported |
| Browser Direct Access | Yes |
| Proxy Required | No |
| JSONP Fallback | Available (`?callback=`) |

**Evidence:**
- Shipapis health check confirms CORS enabled
- GreatAPIs confirms: "CORS: Enabled - Callable directly from browser JavaScript"
- Official docs state: "The PubAPI endpoints can be called, by any kind of client or browsers that supports the HTTP protocol"
- Multiple working browser-based examples exist

### Lichess

| Aspect | Status |
|--------|--------|
| CORS Headers Present | Yes |
| Access-Control-Allow-Origin | `*` (wildcard) |
| Preflight OPTIONS | Supported |
| Browser Direct Access | Yes |
| Proxy Required | No |
| Authorization Header | Supported in CORS |

**Evidence:**
- GitHub Issue #6 confirmed CORS support on game export endpoints
- Lichess API UI is a fully client-side browser app
- Official OAuth app example is client-side only
- Forum posts confirm browser access works
- Authorization header is allowed in CORS preflight

---

## Authentication Feasibility

### Chess.com

| Aspect | Feasibility |
|--------|-------------|
| Browser-only SPA | **Fully viable** |
| OAuth Available | Not needed for public data |
| Token Storage | N/A |
| Security Risk | None - no credentials |

**Conclusion:** Chess.com public game data requires no authentication. A pure frontend implementation is fully viable.

### Lichess

| Aspect | Feasibility |
|--------|-------------|
| Browser-only SPA | **Fully viable** |
| OAuth2 PKCE | Supported for public clients |
| Token Storage | IndexedDB/localStorage |
| Security Risk | Low - tokens are user-scoped |

**Conclusion:** Lichess supports fully client-side OAuth2 PKCE flow. Official examples demonstrate browser-only authentication. A pure frontend implementation is fully viable.

**Recommended OAuth Flow:**
1. Register app as public client (no secret needed)
2. Generate code verifier and challenge (S256)
3. Redirect user to Lichess authorization endpoint
4. Receive authorization code in callback
5. Exchange code for access token
6. Store token in IndexedDB
7. Use token for authenticated requests

---

## Limitations

1. **Data Currency**: Both APIs have caching (12-24 hours for Chess.com, varies for Lichess)
2. **Rate Limits**: Serial requests required; parallel requests may fail
3. **Private Games**: Lichess requires auth token; Chess.com doesn't expose via PubAPI
4. **No Incremental Sync**: Must re-fetch archives to detect new games
5. **Large Archives**: Players with thousands of games will need sequential monthly fetches
6. **Token Expiry**: Lichess tokens expire (~1 year); no refresh token support

---

## Recommendation

### Architecture for V1: Pure Frontend Implementation

**Both Chess.com and Lichess fully support browser-based SPA access without a backend proxy.**

#### Chess.com Implementation

```
┌─────────────────────────────────────────────────────────┐
│  ChessRemedy SPA (Browser)                              │
├─────────────────────────────────────────────────────────┤
│  1. User enters Chess.com username                      │
│  2. GET /pub/player/{username}/games/archives           │
│     → Returns list of monthly archive URLs              │
│  3. For each month (sequential, with delay):            │
│     GET /pub/player/{username}/games/{YYYY}/{MM}        │
│     → Returns JSON with embedded PGN                    │
│  4. Parse PGN and store in IndexedDB                    │
│  5. Handle 429 with exponential backoff                 │
└─────────────────────────────────────────────────────────┘
```

**Key Decisions:**
- Use JSON endpoint (not PGN) for structured data
- Process sequentially with 100ms+ delay between requests
- Cache archive list in IndexedDB
- Use ETag/If-None-Match for conditional requests
- Store `player_id` for username change detection

#### Lichess Implementation

```
┌─────────────────────────────────────────────────────────┐
│  ChessRemedy SPA (Browser)                              │
├─────────────────────────────────────────────────────────┤
│  Option A: Public Games (No Auth)                       │
│  1. User enters Lichess username                        │
│  2. GET /api/games/user/{username}                      │
│     Accept: application/x-ndjson                        │
│     → Streams all public games as NDJSON                │
│  3. Parse NDJSON stream and store in IndexedDB          │
│                                                         │
│  Option B: Private Games (OAuth2 PKCE)                  │
│  1. User clicks "Login with Lichess"                    │
│  2. OAuth2 PKCE flow → receive access token             │
│  3. Store token in IndexedDB                            │
│  4. GET /api/games/user/{username}                      │
│     Authorization: Bearer {token}                       │
│     → Streams all games (public + private)              │
│  5. Parse NDJSON stream and store in IndexedDB          │
└─────────────────────────────────────────────────────────┘
```

**Key Decisions:**
- Default to NDJSON format for streaming large datasets
- Use `since` parameter for incremental sync
- Implement OAuth2 PKCE for users wanting private game access
- Store tokens encrypted in IndexedDB
- Handle 429 with 60-second backoff

### Error Handling Strategy

| Error | Handling |
|-------|----------|
| 404 | Player not found - show user-friendly message |
| 429 | Rate limited - exponential backoff (Chess.com: 1s→2s→4s; Lichess: 60s) |
| 403 | Forbidden - may indicate private games (Lichess) |
| Network Error | Retry with backoff, show offline status |
| Invalid PGN | Log warning, skip game, continue import |

### Duplicate Detection Approach

1. **Game ID**: Both platforms provide unique game IDs
2. **PGN Hash**: Compute hash of PGN moves + metadata
3. **Composite Key**: `{platform}:{game_id}` or `{platform}:{player_id}:{end_time}`
4. **IndexedDB Index**: Create index on composite key for O(1) lookup
5. **Upsert Pattern**: Check existence before insert, update if exists

### Rate Limit Handling

```typescript
// Chess.com: Serial with small delay
async function fetchChessComArchives(username: string) {
  const archives = await fetchWithRetry(
    `https://api.chess.com/pub/player/${username}/games/archives`
  );
  
  for (const url of archives.archives) {
    const games = await fetchWithRetry(url);
    await processGames(games);
    await delay(100); // Polite delay
  }
}

// Lichess: Streaming with backoff
async function fetchLichessGames(username: string) {
  const response = await fetchWithRetry(
    `https://lichess.org/api/games/user/${username}`,
    { headers: { 'Accept': 'application/x-ndjson' } }
  );
  
  // Process NDJSON stream
  for await (const line of response.body) {
    const game = JSON.parse(line);
    await processGame(game);
  }
}
```

---

## Impact on ChessRemedy

### Architecture Impact

1. **No Backend Required**: V1 can be fully browser-based
2. **Service Layer**: Create `ChessComImporter` and `LichessImporter` services
3. **Adapter Pattern**: Wrap API calls behind platform-agnostic interface
4. **IndexedDB Schema**: Design game storage with platform-aware keys
5. **Sync Engine**: Implement incremental sync using date-based filtering

### Required Services

```
src/services/
├── chess-api/
│   ├── chess-com-client.ts      # Chess.com API client
│   ├── lichess-client.ts        # Lichess API client
│   ├── types.ts                 # Shared types
│   └── rate-limiter.ts          # Rate limit handling
├── import/
│   ├── game-importer.ts         # Orchestrates import
│   ├── pgn-parser.ts            # Parses PGN to domain model
│   └── deduplication.ts         # Duplicate detection
└── auth/
    ├── lichess-oauth.ts         # OAuth2 PKCE for Lichess
    └── token-storage.ts         # Secure token storage
```

### Testing Requirements

- Unit tests for API clients
- Integration tests with mock responses
- E2E tests for full import flow
- Rate limit simulation tests
- Offline/sync conflict tests

---

## Open Questions

1. **Chess.com Authenticated API**: Should V1 support accessing private games via Chess.com's authenticated API? (Requires developer registration)

2. **Incremental Sync Strategy**: How frequently should the app check for new games? On app open? Background sync?

3. **Large Archive Handling**: For users with 10,000+ games, should we:
   - Import all at once with progress indicator?
   - Import recent N months first, then background load older games?
   - Allow user to select date range?

4. **Token Storage Security**: Should Lichess OAuth tokens be:
   - Stored in IndexedDB (accessible to JS)?
   - Wrapped with Web Crypto API encryption?
   - Stored in memory only (lost on page close)?

5. **Error Recovery**: What happens if import is interrupted? Resume from where it stopped?

6. **Chess.com Future Auth**: Chess.com mentions "authenticated users" may access more data. Should we plan for future OAuth support?
