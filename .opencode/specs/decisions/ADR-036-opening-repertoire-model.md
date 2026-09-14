# ADR-036: Opening Repertoire Model (post-V1)

## Status

Accepted

## Context

Opening repertoires are future scope (`PRODUCT.md` §1/§17) and are
anticipated by `ARCHITECTURE.md` §12 ("future opening training reuses the
chessboard, game-state and training infrastructure"). `research/opening-repertoire.md`
establishes that the same position arises from different move orders
(transpositions), so a repertoire is a **DAG**, not a tree, and that
position identity must be canonical and move-counter-free.

Feature 021 introduces the repertoire domain and the PGN import/export path
that Features 022–028 build on. It is **scheduling-free**: opening
training/review is Feature 024 and must not change ADR-031/ADR-035. This
ADR decides the repertoire model, the canonical position key, the PGN
round-trip semantics and the storage/sync posture.

## Decision

ChessRemedy models an opening repertoire as a **position-keyed DAG** on
`chessops` (ADR-028), persisted in an additive Dexie schema and round-tripped
through `chessops/pgn` (ADR-030).

1. **Position-keyed DAG.** A repertoire is a directed acyclic graph whose
   **nodes are positions** and whose **edges are moves**.
   - Node identity is `(repertoireId, positionKey)`; transpositions merge
     automatically.
   - Edge identity is `(repertoireId, fromKey, moveUci)`; the edge stores
     `moveSan`, the derived `toKey`, a per-parent `order` (0 = mainline),
     comments and NAGs.
   - The graph is **side-agnostic**; the repertoire `side` is metadata and
     the edge role is derived from the position's side to move
     (`roleOf(edge, side)`), so side never prunes the graph.
2. **Canonical position key.** `positionKeyOf(position) = makeFen(position.toSetup(), { epd: true })`:
   piece placement, side to move and castling rights, with an en-passant
   square present **only when a legal en-passant capture exists**, and move
   counters excluded. The key is idempotent through `parseFen`/`Chess.fromSetup`
   and versioned by `POSITION_KEY_VERSION` (folded into the repertoire
   `modelVersion`); a key change requires an explicit migration that
   recomputes stored keys — never a silent rebuild.
3. **PGN round-trip.** Import parses `chessops/pgn` RAV trees iteratively,
   requires every SAN to be legal (illegal lines are rejected, never
   silently dropped), preserves comments/NAGs and per-parent ordering,
   flattens to the DAG and merges idempotently (set-union with a
   deterministic annotation merge). Export walks the DAG back into a
   canonical mainline plus variations, **expands every occurrence of a
   transposed position** with an informational `transposes` comment, is
   bounded by node/ply budgets with an explicit truncation warning, and
   guarantees `import(export(r)) ≡ r` when not truncated.
4. **Storage.** Additive Dexie schema **v14** with normalized
   `repertoires`, `repertoireNodes` and `repertoireEdges` stores (not a
   document blob), so traversal and counts are indexed and a future sync
   merge is record-level. Repertoire data is **authoritative user data**:
   it is never derived from a game or silently rebuilt, and deleting a game
   never touches a repertoire.
5. **Sync posture.** Repertoires are **local-only** in this feature and are
   not added to the ADR-016 sync envelope. PGN export/import is the manual
   backup path (ADR-001). Enabling repertoire sync later requires a new
   ADR-016 payload version with an `ENVELOPE_MIGRATIONS` transform, new
   `SyncCollectionName`/`SyncCollectionGroup` entries and a new
   `TombstoneKind`; the row `createdAt`/`updatedAt` timestamps needed for
   the ADR-017 merge are already stored.

## Rationale

- A tree keyed by move order duplicates positions reached by different
  orders and breaks shared recall/coverage for transpositions; a
  position-keyed DAG is the minimal model that handles them
  (`research/opening-repertoire.md` §5).
- `chessops` is already the mandated chess library (ADR-028) and exposes
  legal en-passant normalisation (`toSetup()`), FEN/EPD serialisation and
  PGN RAV trees, so no chess logic or new dependency is introduced.
- Normalized tables give indexed parent traversal (`[repertoireId+fromKey]`)
  and per-repertoire counts without loading the graph, and keep a future
  sync merge granular; a document blob would force full rewrites.
- Keeping the DAG authoritative and deriving export avoids two sources of
  truth; storing annotations on edges means a re-import is idempotent.
- Deferring sync keeps the ADR-016 envelope closed and versioned while
  preserving a documented, migration-only path to enable it later.

## Alternatives considered

- **Move-order tree** — cannot share a position reached by two orders;
  rejected.
- **Full FEN (with move counters) as the key** — splits identical positions
  across transpositions; rejected.
- **Whole-repertoire document blob** — no indexed traversal, coarse sync
  merge; rejected.
- **Stored PGN snapshots as the source of truth** — duplicates state and
  makes edits/merges lossy; rejected.
- **Re-deriving the repertoire from PGN on read** — treats user-authored
  data as derived; rejected.
- **Single-expansion export** — lossy for transpositions; a bounded,
  content-preserving expansion with a `transposes` comment is preferred.
- **Sync now** — requires an ADR-016 payload-version bump and migrations;
  deferred, not a conflict.

## Consequences

- A new domain specification `domain/opening-repertoire.md` carries the
  canonical rules.
- Additive schema **v14** (`repertoires`/`repertoireNodes`/`repertoireEdges`);
  `PERSISTENCE_SCHEMA_VERSION` becomes 14.
- **No new external dependency**: `chessops` and browser file/clipboard
  APIs only.
- Opening training/review (Feature 024) will reuse the ADR-035 `Scheduler`
  with a position-edge card key; this ADR does not adopt a scheduler.
- Repertoires stay out of sync until a later ADR-016 extension; PGN
  export/import is the backup path.

## Sources

- `specs/ARCHITECTURE.md` §3, §7, §9, §10, §12
- `specs/PRODUCT.md` §1, §17
- `specs/features/021-opening-repertoire-domain.md`
- `specs/domain/game-model.md`, `specs/domain/review-scheduling.md`
- `specs/decisions/ADR-001` (local-first), `ADR-016` (sync envelope),
  `ADR-028` (chessops), `ADR-030` (chessops/pgn), `ADR-031`/`ADR-035`
  (scheduling separation)
- `specs/research/opening-repertoire.md`
