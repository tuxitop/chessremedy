# Move Classification

Classification categories:

- best
- good
- inaccuracy
- mistake
- blunder

Missed tactical opportunity is a separate classification/attribute
owned by Feature 010 (see `specs/domain/tactics.md` and
`specs/research/tactical-detection.md`).

Classification does not rely exclusively on centipawn loss. It uses
the WDL-derived `wpLoss` metric defined in
`specs/research/move-accuracy.md` and the thresholds fixed in
ADR-023.

It accounts for:

- evaluation change (centipawns)
- WDL where available (ADR-019)
- forced moves (`legalMovesCount == 1`)
- tactical context (missed-tactic flag from Feature 010)
- game phase (only for the centipawn fallback used by the `fast`
  profile)
- position outcome (mate sign flip)

Classification versions must be persisted (see ADR-023 and
ARCHITECTURE.md §9).
