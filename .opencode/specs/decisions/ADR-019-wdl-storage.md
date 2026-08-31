# ADR-019: WDL Storage

## Status

Accepted

## Decision

V1 stores **win/draw/loss (WDL) probabilities** alongside the centipawn
evaluation in every persisted `MoveAnalysis` record.

The on-the-wire representation is the Stockfish UCI `wdl` triplet in
per-mille (integer values that sum to 1000):

```ts
type Wdl = { w: number; d: number; l: number };
```

Persisted shape on `MoveAnalysis`:

```ts
{
  evalCp: number,        // centipawns from side-to-move perspective
  evalMate: number | null,
  wdl: { w: number; d: number; l: number } | null,
  ...
}
```

`wdl` is **nullable**. It is populated by every analysis profile that
requests `UCI_ShowWDL true` (ADR-012 §Profiles: `normal`, `tactical`,
`deep`). It is `null` for the `fast` bulk profile, which does not
request WDL.

## Reasons

- WDL provides a more intuitive win/draw/loss assessment than raw
  centipawn evaluation and is required for the contextual
  classification methodology mandated by ADR-005.
- Stockfish returns WDL as a free by-product of any UCI search that
  sets `UCI_ShowWDL true`. The cost is a few extra integers per
  `info …` line and a small storage increase.
- The classification domain (Feature 009) already references WDL as a
  classification input (`specs/domain/classification.md`, ADR-005).
  Persisting it on `MoveAnalysis` keeps the classifier pure and
  reproducible.
- Storing WDL on the same record as the centipawn eval keeps the
  analysis pipeline deterministic and removes a second lookup at
  classification time.

## Consequences

- `MoveAnalysis` records grow by approximately 24 bytes (three small
  integers) per analyzed position. This is negligible relative to the
  size of the position FEN and the principal variation.
- The classifier (Feature 009) and statistics layer (Feature 014) may
  treat `wdl === null` as "not available" and fall back to centipawn
  evaluation. They must never treat `null` as `{ w: 0, d: 0, l: 0 }`.
- Engine upgrades (ADR-020) and profile changes (ADR-012) can change
  which analyses have WDL populated. Consumers must tolerate mixed
  populations.

## Sources

- `specs/research/browser-stockfish.md` (Open Question 5, Stockfish
  UCI options reference)
- `specs/domain/analysis-model.md`
- `specs/domain/classification.md`
- `specs/ARCHITECTURE.md` §9
- ADR-005 (Analysis and Move Classification)
- ADR-012 (Stockfish WASM build)
- ADR-020 (Engine version upgrade policy)
