# Plan — Feature 008 (revised): Game Analysis, Time Controls & Analysis-Board Review

Revises the shipped Feature 008 Game Analysis into a proper chess
analysis/review experience and corrects the time-control model
product-wide. Spec reconciliation + shared analysis board with Live
Analysis (Feature 006) per ADR-033.

## 0. Dependency & doc context

- Domain canonical rules: `domain/time-control.md`, `domain/clock.md`,
  `domain/analysis-model.md`, `domain/classification.md`,
  `domain/game-phase.md`, `domain/game-model.md`.
- Decisions: ADR-013 (revised), ADR-033 (unified analysis board);
  existing ADR-012/014/018/019/020/023.
- Consumers unaffected in rules: Features 009/010/011/014 read persisted
  `MoveAnalysis` unchanged in spirit; classification/phase algorithms and
  the missed-tactic reserved contract are untouched.

## P1 — Time-control model (domain + persistence + display)

- Domain value object in `src/domain/chess/timeControl.ts`:
  parse (dialects incl. `{sec}`, `{sec}+{inc}` fractional, `1/86400`,
  `"N days per move"`, `-`/`?`), classify (canonical base+40×inc rule,
  versioned), format (`M|I` house style with fallbacks). Keep raw verbatim;
  keep `TIME_CONTROL_CATEGORIES`; add parse/classify/format versions.
- Game model carries structured time control; providers may supply a
  platform label hint (Lichess `speed`/Chess.com `time_class` where
  available). Fixture corrections (lichess correspondence dialect; add a
  `5+5` game; no regressions to existing fixtures).
- Persistence: schema v5 (additive) stores the structured value on the
  games row; `normalizedTimeControl` index retained; migration test
  v4→v5 (backfill parses raw on read when the structured value is absent).
- Display: Library and every time-control surface render
  `TimeControl.display` (e.g. `5|5`, `10|0`, `3 days/move`); remove raw
  seconds from display. Library filters remain category-based.
- Tests: parse/classify/format tables incl. boundaries 179/180/479/480/
  1499/1500, sub-second increments, day-words, `-`/unknown, ultraBullet
  fold, display regression (`300+5 → 5|5`, never seconds-as-minutes);
  migration + repository tests.

## P2 — PGN clocks

- `src/domain/chess/clock.ts`: structured `MoveClock { ply, color,
  clockMs }` parser built on chessops `parseComment` (`%clk` extraction;
  `%emt` kept separate; variations; missing/malformed tolerated).
- MoveList comment rendering strips all structured tags (`%clk`, `%emt`,
  `%eval`, `%cal`, `%csl`); no annotation is shown as prose.
- Analysis plan/build may carry `clockAfterMs` when present.
- Tests: parse placement white/black, fraction/leading-zero tolerance,
  missing/malformed, variations, never-as-comment, `%emt` separation.

## P3 — Shared analysis board (006 migration)

- Extract shared board surface (`src/components/analysis/board/…`):
  board + eval bar + move list + engine-lines panel + controls + arrows,
  driven by a single "mode" (stored | live). Move Live Analysis
  (LiveAnalysisPage) onto the shared surface (behavior preserved; no
  engine-start on stored mode).
- Live mode reuses the Feature-005 controller (engine on/off, profile,
  MultiPV/lines, depth/time, arrows, engine status/progress).
- Component tests reuse the existing fake engine rig.

## P4 — Review rebuild (stored mode)

- Review consumes persisted `MoveAnalysis`: eval bar (eval-after of the
  selected ply, mate/orientation), per-move evals in the move list,
  engine-lines panel from stored `bestMove`/`bestPv`/`multipvLines`,
  best-move arrows toggle, classification glyphs, verdict panel
  ("played vs recommended", swing, recommended continuation preview) for
  user inaccuracy/mistake/blunder.
- Navigation/keyboard/a11y: shared nav + `aria-current="step"`; responsive
  desktop/tablet/mobile (mobile segmented Moves/Lines/Review + collapsible
  panels).
- States: missing, unanalyzed, queued/in-progress (progress), failed,
  cancelled, obsolete (identity chip + opt-in re-analyze).
- Live analysis on Review: separate mode, never overwrites stored records;
  returns to stored mode.
- Tests: review component suite (board sync, eval bar from stored evals,
  lines single/multi/none, arrows toggle, verdict, live no-overwrite,
  a11y, responsive) + domain summary/model updates.

## P5 — Library workflow & progress

- Row action/overflow + selection toolbar: Analyze, Review, Re-analyze,
  Delete, Cancel as applicable; statuses incl. Outdated.
- Batch/per-game progress surfacing from the persistent job queue
  (completed/analyzing/queued/failed; positions done/total; profile); no
  fabricated ETA.
- Tests: actions availability, status rendering incl. outdated, progress,
  batch flows.

## P6 — Analysis model additions

- `MoveAnalysis` optional per-line `depth`; optional `clockAfterMs`;
  analysis-service/build adapters; tests.

## P7 — Verification

Focused vitest → full gate (`lint`, `typecheck`, `format:check`, `test`,
`build`, `dev` smoke, `test:browser`, `audit`). New e2e: import game with
`%clk` → analyze (fast, real engine) → Review shows eval bar/lines/arrows →
enable live → return to stored → navigate; Library batch progress visible.

## Deferred (out of scope)

Statistics UI (Feature 014/015), puzzle generation/training (010–013),
time-pressure analytics, opening/repertoire tooling.
