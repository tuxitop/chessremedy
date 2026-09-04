# PGN Clock Annotations

Canonical handling of per-move clock data from PGN comments (`[%clk …]`)
for ChessRemedy.

## Convention (researched)

`[%clk H:MM:SS[.fff]]` inside a move's brace comment records the **remaining
time of the side that just moved, measured after that move**. It is not
wall-clock time, not a before-move value, and not elapsed move time.

- White's annotations appear only on white moves; Black's only on black
  moves.
- Lichess writes whole seconds with hours unpadded (`[%clk 0:03:00]`);
  Chess.com writes tenths (`[%clk 0:02:58.3]`). Accept hours with a leading
  zero and fractional seconds; take the first valid `%clk` per comment.
- `[%emt …]` is **elapsed move time** and must be kept separate (or
  dropped) — never folded into clock data.
- Annotations are optional: final plies, flag/resign endings,
  correspondence/daily games and aborted games may lack them. Do not
  fabricate missing clocks.

Sources: Lichess/scalachess `Pgn.scala` (`timeLeft … after the move`),
python-chess `clock()`, chessops `parseComment()`; real Lichess and
Chess.com exports.

## Parsing

chessops already exposes each move node's raw comment strings. Use
`parseComment()` (chessops/pgn) to strip `%clk`/`%emt`/`%eval`/`%cal`/`%csl`
structurally; only the residual human `text` is ever rendered as a comment.
Clock tags are consumed even inside variations.

## Model

Per-ply data aligned with `analysis-model.md`'s records:

```
MoveClock { ply, color, clockMs }   // mover's remaining time AFTER the move
```

Clocks are preserved because the raw PGN is stored verbatim; the structured
model is derived deterministically for the UI and analysis. Move time spent
on a move is always derived (consecutive same-color clocks plus the
`TimeControl` increment) and is approximate — never stored as if measured.

## Versioning & future

Time-pressure analysis (blunders under time pressure, average move time)
is future work; it must correlate classification/evaluation loss/game phase
with remaining clock, move time and time-control category. The data model
keeps clock, move time (derived) and category available for that.
