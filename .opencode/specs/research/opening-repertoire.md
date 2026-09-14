# Opening Repertoire Creator & Trainer

> **Status: Future scope (not a V1 decision).** `PRODUCT.md` §1/§17 lists
> opening repertoires, opening training, opening puzzles, and repertoire
> compliance as future scope; `ARCHITECTURE.md` §12 notes that future
> opening training reuses the chessboard, game-state and training
> infrastructure. No V1 feature spec exists. Adopting this research
> requires a new feature spec and an ADR (see Recommendation). This
> document does **not** adopt anything for V1 and must not silently
> change ADR-028 (chessops), ADR-031 (no scheduler library in V1), or
> ADR-001 (local-first).

## Question

1. What features does chessbook.com offer as an opening repertoire
   builder/trainer?
2. How could an opening repertoire creator + trainer be integrated into
   ChessRemedy's existing architecture (pure domain on `chessops`, Dexie
   local storage, Stockfish in Web Workers)?
3. What free chess-opening databases/APIs are available, and under what
   licenses/terms?
4. How should spaced repetition for opening lines be implemented, given
   ADR-031 forbids a per-puzzle scheduler/FSRS dependency in V1?
5. What chess-correctness issues (transpositions, move order, side
   selection, PGN variation trees) must be handled?

## Sources

Repository:

- `.opencode/specs/ARCHITECTURE.md` §2, §3, §5, §7, §12
- `.opencode/specs/PRODUCT.md` §1, §17
- `.opencode/DECISIONS.md` ADR-001, ADR-004, ADR-018, ADR-024, ADR-027,
  ADR-028, ADR-031, ADR-033
- `.opencode/specs/research/fsrs-implementation.md`
- `.opencode/specs/research/cycle-training.md`
- `.opencode/specs/research/game-import.md`
- `src/infrastructure/db/database.ts`, `src/infrastructure/db/schema/v12.ts`
- `src/infrastructure/engine/types.ts`, `engineService.ts`, `cache.ts`
- `src/infrastructure/providers/{lichess,chessCom}.ts`
- `src/domain/tactics/`, `src/domain/statistics/`,
  `src/infrastructure/training/`

Web (primary / official):

- Chessbook homepage (feature copy, `<meta name="description">`):
  https://chessbook.com/
- Chessbook App Store listing (feature list, free-move cap, Pro pricing):
  https://apps.apple.com/us/app/chessbook-master-openings/id6466343415
- Chessbook founder launch post (custom repertoire, gap detection, SM-2,
  templates, Lichess-game generation, PGN export, transpositions):
  https://www.reddit.com/r/chess/comments/vw5uie/i_made_a_website_to_help_you_create_and_memorize/
- Independent review (openings-only):
  https://lichess.org/@/CheckRaiseMate/blog/spaced-repetition/eteyH8MT
- `lichess-org/chess-openings` (CC0, fields, conventions, ~3,815 lines):
  https://github.com/lichess-org/chess-openings
- Lichess Opening Explorer now requires authentication (OAuth2,
  25 req/min, 50-ply depth):
  https://lichess.org/@/thibault/blog/the-opening-explorer-now-requires-authentication/FSWh9Zg3
- Lichess OpenAPI spec (Opening Explorer `security: OAuth2`, host
  `explorer.lichess.org`):
  https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/lichess-api.yaml
  and `.../tags/openingexplorer/masters.yaml`
- Lichess API rate-limit tips: https://lichess.org/page/api-tips
- `lila-openingexplorer` (endpoints `/masters`, `/lichess`, `/player`;
  AGPL-3.0): https://github.com/lichess-org/lila-openingexplorer
- Lichess open database (CC0): https://database.lichess.org/
- Chess.com Published-Data API (read-only public data, brand/IP
  restrictions, no opening-stats endpoint):
  https://www.chess.com/news/view/published-data-api
- SM-2 algorithm (Woźniak 1990):
  https://super-memory.com/english/ol/sm2.htm
- FSRS algorithm (FSRS-6, DSR model, 21 params):
  https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
- Leitner system: https://en.wikipedia.org/wiki/Leitner_system
- Transposition (chess):
  https://en.wikipedia.org/wiki/Transposition_(chess)
- chessops PGN tree + transform/walk:
  https://niklasf.github.io/chessops/modules/pgn.html
- chessops FEN/EPD:
  https://niklasf.github.io/chessops/modules/fen.html

Live verification (this environment): `curl https://explorer.lichess.org/masters?...`
returned **HTTP 401 Authorization Required** (with
`access-control-allow-origin: *`); same for `explorer.lichess.ovh`.
Confirms the auth requirement.

## Findings

### 1. Chessbook features (chessbook.com)

Chessbook is a commercial, account-based (free tier + Pro) opening
repertoire builder and trainer. Confirmed features:

- **Custom repertoire builder** — combine openings from multiple sources
  (books, videos, own ideas) into one repertoire; supports White and
  Black.
- **Spaced repetition training** — per-move/per-line drilling. The
  founder states the scheduler is "an improved version of SuperMemo 2"
  (SM-2), run client-side. Marketing language, not an independent
  efficacy claim.
- **Automatic gap detection / coverage tracking** — "calculates your
  coverage per opening," finds the most probable opponent move not
  covered, using Lichess game statistics at a rating band (founder: "10
  million+ games played by 1800–2200 rated players on lichess").
- **Move selection by probability/win-rate** — prioritise lines actually
  seen at the user's level.
- **Transposition handling** — explicitly claimed; essential for
  `1.d4/c4/Nf3` repertoires.
- **Import/export via PGN** — add variations and export to other tools.
- **Repertoire templates** — generate a starter repertoire by mixing
  built-in templates.
- **Generate repertoire from Lichess games** — from the user's recent
  games (~200 at launch in 2022).
- **Online-game repertoire compliance** — connect Chess.com or Lichess
  and get feedback when you deviate from your repertoire.
- **Model games / "guess the move"** — play through master games in your
  openings and guess the next move.
- **Middlegame plan guidance** — "learn middlegame plans for any
  opening."
- **Web + iOS + Android**; offline mobile app (Capacitor). Free tier
  capped (App Store: "400 moves"; landing page Starter: "up to 200
  moves"). Pro: **$7.99/month or $79.99/year** (App Store IAP; 2022
  launch post said $4/month).

It is **openings-only** (no tactics/endgames) per the review. Source is
closed-source/commercial.

### 2. Integration into ChessRemedy's architecture

`ARCHITECTURE.md` §12 already anticipates this; `PRODUCT.md` lists it as
future scope. No V1 spec exists, so it requires a new feature spec + ADR.

- **Domain** (`src/domain/repertoire/`, pure TS on `chessops`, no
  React/DB/Worker imports per `ARCHITECTURE.md` §3):
  - Repertoire graph model (position-keyed **DAG**, not a tree — see §5).
  - PGN → graph import via `chessops/pgn` (`parsePgn`, `PgnNodeData`,
    variations/NAGs/comments; `transform`/`walk`) — the library already
    mandated by ADR-028.
  - Position identity via `chessops/fen` (`makeFen`/`parseFen`;
    `INITIAL_EPD`/`EMPTY_EPD`) → canonical EPD key.
  - Coverage/gap analysis (needs an opening-stats provider; see §3).
  - Self-implemented scheduler (§4) and training/session state.
  - Repertoire compliance: walk an imported game and compare plies to the
    graph.
- **Infrastructure**:
  - New Dexie tables in a new additive schema version (current is **v12**
    in `src/infrastructure/db/database.ts` /
    `src/infrastructure/db/schema/v12.ts`): e.g. `repertoires`,
    `repertoireNodes` (keyed by `[repertoireId, positionKey]`),
    `repertoireMoves` (edges), `repertoireReviews` (immutable attempt
    rows), optional `repertoireLines` (PGN snapshots for import/export).
    Follow the existing additive-migration pattern and deletion cascades
    (`ARCHITECTURE.md` §7).
  - Reuse `src/infrastructure/engine/engineService.ts` (+ ADR-018
    FEN-keyed cache) to evaluate candidate moves and verify gaps. Engine
    noise in the opening is a known caveat (ADR-024 excludes the first 8
    plies / book moves from accuracy).
  - Reuse `src/infrastructure/providers/{lichess,chessCom}.ts` adapters
    for repertoire compliance over the user's games.
  - Chessground wrapper for the training board; the shared analysis-board
    surface (ADR-033) can host the repertoire review UI.
- **Sync**: if repertoires are backed up, add them to the ADR-016 sync
  envelope collections and ADR-017 merge rules; do **not** sync the
  engine cache (ADR-018). Local-first/offline must hold (ADR-001): the
  trainer must work with a bundled opening-name dataset and a local
  scheduler; network only for stats/compliance.

### 3. Free opening databases / APIs and licenses

| Source | What it gives | License / terms | Notes |
|---|---|---|---|
| `lichess-org/chess-openings` | ~3,815 named lines across a–e TSV (~388 KB; a=818, b=773, c=1251, d=615, e=358 rows); fields `eco`, `name`, `pgn`, plus generated `uci`/`epd` in `dist/` | **CC0-1.0** (public-domain dedication) | Canonical open ECO-name dataset. Vendoring is licence-clean and enables offline. Classify by playing moves backwards to a named position; multiple entries per opening handle transpositions; EPD en-passant only when legal. Also on Hugging Face (Apache Parquet). |
| Lichess Opening Explorer API | Position statistics (`/masters`, `/lichess`, `/player`), move stats, opening name/ECO, model games | **OAuth2 now required** (since Mar 3, 2026); free with a Lichess account; **25 req/min**; max depth 50 plies; server code AGPL-3.0; API use subject to Lichess TOS | Host is `explorer.lichess.org` per the current OpenAPI spec (older docs/code use `explorer.lichess.ovh`). Anonymous requests return **HTTP 401**; CORS present and `Authorization` allowed, so a browser OAuth2 PKCE token works. Lichess games are CC0; the masters DB is compiled and not stated as CC0. |
| Lichess open database | Full games, puzzles, evals, openings | **CC0-1.0** | `database.lichess.org` explicitly CC0. Very large; not needed for a repertoire trainer. |
| Chess.com Published-Data API | Player/game archives (PGN + `eco` URL field); **no opening/position-stats endpoint** | Public, keyless, read-only; brand/IP restrictions (no reuse of board palettes, piece designs, sounds, classification glyphs) | CORS enabled; serial requests unlimited, parallel may 429. No opening-explorer equivalent. |
| ECO data | ECO codes + names | Effectively the same as `chess-openings` (CC0); community `eco.json`-type datasets exist but are not primary | Use `chess-openings` as the single open source of ECO/name data. |

Key consequence: the historically keyless Lichess explorer is now
**auth-gated**. ChessRemedy needs a Lichess OAuth2 PKCE flow (already
researched in `game-import.md`) and must degrade gracefully offline using
bundled CC0 names/ECO and local Stockfish.

### 4. Spaced repetition for opening lines

Three established models were reviewed:

- **Leitner boxes** (Leitner 1972): cards promoted/demoted between boxes
  with increasing intervals; trivially simple, no memory-strength maths.
  Good fallback, coarse.
- **SM-2** (Woźniak 1990): initial intervals `I(1)=1`, `I(2)=6`,
  `I(n)=I(n-1)·EF`; `EF' = EF + (0.1 − (5−q)·(0.08 + (5−q)·0.02))`,
  clamped `EF ≥ 1.3`; q<3 restarts the item. This is what Chessbook says
  it uses ("improved SM-2"). ~15–20 lines of pure arithmetic, **no
  dependency**.
- **FSRS** (open-spaced-repetition, currently **FSRS-6**, 21 parameters,
  DSR model): more accurate but needs per-user parameter optimisation and
  per-item `stability`/`difficulty` state. `research/fsrs-implementation.md`
  recommends `ts-fsrs` (MIT, zero runtime deps) only for a future
  individual scheduler; ADR-031 forbids a scheduler library in V1.

For an **opening** trainer the review unit is naturally a position/edge
("given this position, play my move"), unlike a fixed-set puzzle cycle.
Two viable designs:

1. **Self-implemented per-position scheduler (recommended):** store
   immutable `repertoireReviews` (positionKey, move played, correct?,
   latency, hints, timestamp) and derive `due`/interval from a domain
   function. Start with SM-2 (or a small Leitner box) — no dependency,
   deterministic, testable, consistent with ADR-031's "no scheduler
   library / data model stays open to a future individual scheduler."
2. **Cycle training reuse:** treat the repertoire as a fixed block and
   reuse the Woodpecker-style cycle model already in
   `specs/domain/tactical-training.md` / ADR-031. Simpler and consistent
   with V1, but less suitable for large, continuously edited repertoires.

Chess-specific scheduler notes:

- Grade at the **position** (recall of the move), not the whole line; a
  line is a sequence of independently reviewable decisions.
- A wrong move should demote the position and typically the immediately
  preceding branch context; downstream positions should not be credited
  from a single pass.
- If two move orders reach the same position, review state should be
  **shared via the position key** (transposition-aware scheduling) — this
  is why the graph is keyed by position, not by line.
- Store attempt rows immutably so a future FSRS can replay history without
  migration (mirrors ADR-031's rationale).

### 5. Chess correctness for repertoire trees

- **Transposition / move order.** The same position arises from different
  move orders (e.g. `1.d4 d5 2.c4 e6 3.Nc3 Nf6` ≡
  `1.c4 e6 2.Nc3 Nf6 3.d4 d5`). A repertoire is therefore a **DAG**, not
  a tree. Model nodes by a **position key**, moves as labelled edges.
  `lichess-org/chess-openings` explicitly does this ("play moves backwards
  until a named position is found… multiple entries for a single opening
  may be added" for transpositions; each name has a unique *shortest*
  line).
- **Canonical position key.** Use an **EPD/FEN without move counters**
  (piece placement, side to move, castling rights, en-passant *only when
  a legal en-passant capture exists*). Exclude halfmove/fullmove clocks —
  not part of position identity and differ across transpositions.
  `chessops/fen` exposes `parseFen`/`makeFen` and EPD constants;
  `makeBoardFen`/`parseBoardFen` exist if a looser key is desired.
  En-passant normalisation matters: a FEN may carry an en-passant square
  no pawn can legally capture, splitting identical positions.
- **Side selection.** A repertoire is for a side (White and/or Black).
  Training must quiz only **the user's moves**; opponent moves are
  prompts/branches. Compliance must compare only the user's plies.
- **Opponent deviation / gaps.** When the opponent plays a move not
  covered by an edge, that is a gap (a leaf in coverage). Gap detection
  needs external frequency data (Lichess explorer) or a local heuristic;
  offline, the app can only flag "no response defined."
- **PGN variation trees.** `chessops/pgn` parses RAV variations into a
  `PgnNode` tree with comments/NAGs and can `transform`/`walk` to
  annotate each node with a FEN/EPD (ADR-028, ADR-030). Import means
  flattening the RAV tree into the position-keyed DAG and de-duplicating
  transpositions. Export means walking the DAG back into a PGN tree
  (canonical mainline per position; the rest become RAV variations).
- **Chess960/castling.** `chessops` supports Chess960; castling rights
  are part of the key. V1 can scope to standard chess, but the key must
  include castling rights to avoid false transpositions.

## Limitations

- **Chessbook is closed-source and client-rendered.** Its feature list
  comes from its own marketing copy, App Store listing, founder's launch
  post, and a third-party review — not its code or docs. Some claims
  (e.g. "scientifically proven") are marketing, not evidence. The
  founder's detailed post is from 2022 and some features/pricing have
  changed (free cap 400 vs 200; price $4 vs $7.99).
- **Explorer data licensing is mixed.** Lichess *games* and
  `chess-openings` are CC0, but the explorer's **masters** database is a
  compiled dataset with no explicit CC0 statement; API use is governed by
  Lichess TOS. Because the API is now OAuth-gated, it is not a keyless
  public endpoint.
- **No controlled studies** establish that SM-2/FSRS beats cycle training
  for *opening* memorisation specifically; the choice is a
  product/engineering decision (consistent with `cycle-training.md`'s "no
  comparative claim" caveat).
- **No first-party Chess.com opening database.** The PubAPI exposes no
  position statistics, so gap detection at the user's level cannot be
  sourced from Chess.com.
- The explorer returned 401 from this environment; a real OAuth token was
  not exercised, so exact scopes/response behaviour with a token were not
  re-verified live (the blog states any OAuth token; the spec shows
  `OAuth2: []`, i.e. no specific scope).
- Repository schema is at **v12** while `ARCHITECTURE.md` §7 still says
  v11 — doc/impl drift to resolve when a new schema version is added.

## Recommendation

1. **Treat opening repertoire as a new post-V1 feature** (spec + ADR),
   not an extension of Features 001–016. It is explicitly future scope in
   `PRODUCT.md` and anticipated in `ARCHITECTURE.md` §12.
2. **Build the domain model as a position-keyed DAG** on `chessops`, using
   an EPD (no move counters; en-passant normalised to legal-only) as the
   node key, moves as edges, and side selection to mark which edges the
   user must recall. Import/export via `chessops/pgn` RAV trees.
3. **Self-implement the scheduler in the domain layer** (SM-2 or a small
   Leitner box) over immutable per-position review rows. Do **not** add
   `ts-fsrs`/FSRS in V1 (ADR-031); keep the data open to a future FSRS
   replay. If a fixed-set approach is preferred for parity with V1
   training, reuse the existing cycle-training domain instead.
4. **Bundle `lichess-org/chess-openings` (CC0)** for offline opening
   names/ECO. Use the **Lichess Opening Explorer via OAuth2 PKCE** (reuse
   the existing Lichess auth path) only for online gap/coverage stats,
   cached locally; degrade gracefully offline. Do not rely on Chess.com
   for opening statistics; respect Chess.com's brand/IP restrictions if
   displaying any Chess.com data.
5. **Reuse existing infrastructure**: Chessground wrapper, shared
   analysis board (ADR-033), engine service + ADR-018 cache for move
   evaluation/gap verification, providers for repertoire compliance, and
   Dexie additive schema versioning with the ADR-016/017 sync envelope for
   optional backup.

## Impact on ChessRemedy

- **New scope, new ADR.** Not covered by any current feature spec; needs
  its own feature number and an ADR covering (a) the DAG/position-key
  model, (b) the scheduler choice (self-implemented vs cycle reuse), and
  (c) the explorer OAuth dependency. It must not silently alter ADR-028
  (chessops), ADR-031 (no scheduler library), or ADR-001 (local-first).
- **Offline-first is preserved** if opening names are bundled (CC0) and
  scheduling is local; the only network needs are optional coverage stats
  and optional game-import compliance.
- **The Lichess explorer is no longer keyless** — this invalidates any
  assumption that opening stats can be fetched anonymously. Budget for
  OAuth2 PKCE, token storage, rate limiting (25 req/min), and a local
  cache.
- **Engine use should be selective.** Opening positions are engine-noisy
  and ADR-024 already excludes book/first-8-ply moves from accuracy; use
  the engine for gap verification and move validation, not for
  classifying opening play.
- **Storage/sync.** A position-keyed DAG needs careful indexes
  (`[repertoireId, positionKey]`) and deletion cascades; if synced, add it
  to the ADR-016 envelope and ADR-017 merge with immutable review rows
  (creation-timestamp merge, as in v12).
- **Testing.** Pure domain functions (position key, transposition de-dup,
  PGN↔DAG round-trip, SM-2/Leitner transitions) are deterministic and fit
  the existing Vitest/domain-fixture pattern (ADR-009); no new dependency
  required.

## Open questions

1. **Feature numbering and scope.** Where does opening repertoire sit in
   the roadmap (after 016 Synchronization)? Is the creator, the trainer,
   and compliance one feature or three?
2. **Scheduler choice.** Self-implemented SM-2 vs Leitner vs reusing
   cycle training — needs a product decision and an ADR before
   implementation. Does an opening scheduler belong in V1-adjacent scope
   or strictly post-V1?
3. **Explorer OAuth.** Which scopes does the explorer actually require
   with a real token, and is the `masters` dataset acceptable to display
   under Lichess TOS? Verify with a live token before committing.
4. **Bundled dataset.** Confirm the exact `chess-openings` release/format
   to vendor (raw TSV vs generated `dist/` JSON) and the update policy for
   a vendored CC0 dataset.
5. **Gap heuristics offline.** What local fallback (e.g. own game history
   frequency) is acceptable when the explorer is unavailable?
6. **Compliance UX.** How is repertoire deviation surfaced without
   interfering with V1 game-analysis flows (Feature 008/009)?
