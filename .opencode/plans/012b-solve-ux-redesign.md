# Feature-012 Solve UX Redesign (interim /puzzles host) — Plan 012b

Status: Draft for owner review. Base: HEAD `b968c22` (clean tree).
Scope: rework the Feature-12 `SolveScreen` solving experience plus its interim
`/puzzles` practice host; do NOT touch Feature-011 per-game view, attempt
persistence semantics, domain outcome model, or Feature-013.

## 1. Objectives

Reshape the puzzle-solving surface so it reads like a chess analysis page:

- Right panel is the standard game **move list** (prefix + played moves as
  mainline, wrong attempts as variations), no classification glyphs, auto-scrolled
  to the current move.
- Board is **drawable**; remove the keyboard text-move entry.
- In-list result feedback (green Success / green "Solved with hints" / red
  Failed) instead of page swaps; transport + restart controls under the move
  list like Analysis/Review; keyboard arrow navigation across the played line.
- After finish the **engine** becomes available (toggle on): eval bar appears
  in reserved space without shifting layout; AnalysisPanel engine lines +
  settings behave like the analysis page.
- Hints show a highlighted piece square + a yellow arrow to the destination;
  using hints never fails the puzzle; a solve after any hint (or wrong move)
  keeps the existing domain outcome `solvedWithHelp` (stored as-is — owner
  ruling: keep `solvedWithHelp`, do NOT rewrite it to failed) and the UI shows
  "Solved with hints". View-the-Solution = give up: it plays the stored
  solution out and marks Failed.
- New Settings row: show/hide the solve timer, default hidden.
- Remove hint/wrong-move counters and per-ply eval chips from the solve view.

## 2. Owner rulings (binding)

1. 2nd hint does **not** fail. Play on; if solved afterwards, finish shows
   "Solved with hints"; engine post-finish behaviour identical to a finished
   puzzle.
2. View-the-Solution plays the stored solution out -> Failed at its end;
   engine analyzes that end. Success analyzes the end of the played solution.
3. Move-list model: game prefix + solution mainline; wrong moves are
   variations.
4. Timer toggle default hidden (OFF).
5. Result indicator lives inside the move-list container ("just a green success
   is enough"); keep the view otherwise unchanged, minimize churn. Eval bar
   appears only when the engine toggle is on and must not move other elements
   (reserve the bar column space).

## 3. Current-state anchors (verified at b968c22)

- `src/components/puzzles/solve/SolveScreen.tsx` — solving UI with header
  clock (`solve-clock`), counters aside, hint list, `KeyboardMoveEntry`,
  Restart/Hint/Skip/Give-up buttons; outcome/postSolve swap to OutcomePanel /
  PostSolvePanel.
- `src/hooks/usePuzzleSolve.ts` — controller (stage solving|outcome|postSolve|
  error; `playedLine` UCI tokens; `playBoardMove`, `revealHint`, `restart`,
  `skip`, `giveUp`, `goToPly`, `openPostSolve`, `retryWrite`, `exitOutcome`).
  Domain reducer in `src/domain/training/solve.ts`; hint content
  `src/domain/training/hints.ts` (HintContent {level,text,squares});
  outcome/attempt building `src/domain/training/outcome.ts`.
- Move list reuse: `src/components/chessboard/MoveList.tsx`
  ({tree,path,onSeek,plyEvals,nagOverrides}), `MoveListPane.tsx`,
  `Navigation.tsx`, `useAnalysisNavigation.ts`; tree model in
  `src/components/chessboard/positionTree.ts` (`treeFromFen`, `play`, paths,
  variations). No auto scroll-into-view exists — must be added for prefixes.
- Analysis chrome: `AnalysisBoard.tsx`, `EvaluationBar.tsx`, `AnalysisPanel.tsx`
  (engine toggle + `EngineSettingsPopover`), `useBrowserAnalysisEngine.ts`,
  `useEngineDefaults.ts`, `useAnalysisController.ts`, `engineArrows.ts`.
  Reference layout: `LiveAnalysisPage.tsx:309-390`; review layout
  `GameReviewPage.tsx:988-1156`.
- Prefix source: `MoveAnalysis` rows (`records[ply].ply===ply`,
  `records[sourcePly].positionFen===row.startingFen`);
  `analysesRepository.listForGameAndAnalysis`; job select via
  `analysisStatusOf`/`latestCompletedJob`; `PuzzleRow` fields (sourceGameId,
  sourcePly, startingFen, sideToMove, bestMove/bestPv, acceptedFirstMoves).
- Settings: `SETTINGS_KEYS` in `src/config/app-config.ts`; boolean-hook
  template `useBoardAppearance.ts`; SettingsPage checkbox row pattern.
- Interim host `src/pages/PuzzlesPage.tsx` (picker + session) — becomes the
  "next puzzle" driver; non-persisting `createPracticeRecorder`.

## 4. Design decisions

- **Prefix tree.** For a puzzle row: load the latest completed analysis of
  `sourceGameId`, take `records.slice(0, row.sourcePly)` as the prefix, build a
  `MoveTree` from `treeFromFen(records[0].positionFen)` then `play()` each
  prefix UCI, then the played/puzzle moves append to the same mainline.
  Wrong attempts append as variation children under the decision ply
  (siblings), exactly like Review's explore-moves; the mainline decision point
  stays where solving resumes.
- **Active ply + transport.** `path` selects the current view position; auto
  `scrollIntoView({block:'nearest'})` on the active move token whenever the
  path changes (prefix can be long). Transport (Navigation buttons + left/right
  arrows, Shift for first/last) moves across the whole line (prefix + played +
  revealed solution). Solving only accepts input at the decision point; viewing
  earlier moves is allowed but you return to the decision point to play.
- **Board.** During solving: interactive at the decision point AND drawable
  (user arrows). After finish: warm-frozen drawable board replaying the final
  line. Hint shapes = yellow source-square highlight + yellow arrow
  (`uciMoveArrow(uci,'yellow')`) on the current decision move. Wrong attempt
  flash red arrow (kept). Remove `KeyboardMoveEntry` (its component + export +
  the `submitTextMove` text path in the controller).
- **Hints.** Repeated presses stay available; each reveals (or re-reveals) the
  current decision move's source square + destination arrow. Use any hint
  marks the presentation `helped`; a later solve derives result
  `solvedWithHelp` (already supported by domain outcome via counters). Hints
  never change result to failed. Hidden after the final decision move is
  played or when solved/finished.
- **Finish states (single view, no page swap).**
  - Success (solvedFirstTry) -> green "Success".
  - Solved with hints -> green-typed "Solved with hints".
  - View-the-Solution / Failed -> plays the stored `bestPv` out on the
    mainline (green solution), red "Failed".
  All three remain on the solve view: engine toggle becomes available, the
  eval-bar column shows content only when engine enabled, and a "Next puzzle"
  control appears (host advances cursor / completion panel when the last row
  is done). Attempt recording via the injected recorder is unchanged
  (domain outcome already distinguishes the results; interim host is
  non-persisting).
- **Right panel composition (single side panel, minimal churn).** Keep the
  existing page shell. Inside the move-list pane (MoveListPane) render the
  status line "{color} to move…" + Hint (icon) + Solution (icon) at the
  container bottom; Restart appears once the user has started playing, used a
  hint, or finished. Beneath the move list pane keep the Navigation transport
  row (Analysis/Review style). When the puzzle is finished and the engine is
  toggled on, the engine panel content (AnalysisPanel-style lines + settings)
  takes the space the existing side header uses; eval bar appears in the
  reserved bar column.
- **Engine wiring.** Post-finish, feed `useAnalysisController` with
  `fen = records[0].positionFen`? No — with the **final line position FEN**
  (end of played/revealed solution). Engine off by default; toggle on starts
  analysis exactly like Live/Review. Bar column always rendered but empty until
  engine on, so nothing shifts.
- **Settings.** New `puzzleTimer` key; new row under a "Puzzles" settings
  section: "Show puzzle timer" checkbox, default off. When off hide the
  `solve-clock` (and outcome timer row stays as-is or is hidden too — hidden,
  to satisfy "don't show how many/hints/time").

## 5. Staged implementation

- **A. Shared move-list + transport plumbing.** Add a small pure module
  `src/domain/puzzle/moveLine.ts` (or under components/chessboard) that, given
  `MoveAnalysis` prefix records + a `PuzzleRow`, yields prefix mainline tokens
  and materializes a `MoveTree` (`treeFromFen` + `play`), plus helpers
  `positionAtPath`/`fenOf` reused by engine wiring. Add `scrollActiveMoveIntoView`
  behaviour to `MoveList` behind a prop (`autoScroll?: boolean`, default false,
  so Review/Live are untouched) — implement via an effect that
  `scrollIntoView`s the `[aria-current]` row when the active id changes.
  Tests: moveLine unit (prefix reconstruction equals `startingFen`; a wrong
  variation appended as sibling) + MoveList autoScroll test.
- **B. SolveScreen rework.** Compose new solve view using A + existing
  controller; right panel = MoveListPane(MoveList) with the status/hint/
  solution/restart footer inside the pane and Navigation beneath; remove
  OutcomePanel/PostSolvePanel page-swap (fold into solve view states);
  remove counters and KeyboardMoveEntry; hints become square+arrow shapes;
  drawable board. Keep `usePuzzleSolve` domain transitions intact, only trim
  the text-move input path. Component tests rewritten against the new markup
  (new testids below).
- **C. Post-finish engine.** Add engine panel (toggle/lines/settings) using
  `useBrowserAnalysisEngine` + `useEngineDefaults` + `useAnalysisController`
  at the final-position FEN; reserved eval-bar column rendered but empty until
  enabled; arrows = `engineArrowShapes`. Wire into SolveScreen for finished
  states only. Tests with a stubbed engine service (no real Stockfish).
- **D. Host + settings.** `PuzzlesPage` session: "Next puzzle" advances the
  cursor, final row shows the completion panel; add `usePuzzleTimerSetting`
  (default hidden) + SettingsPage row + tests; solve view reads the setting.
- **E. Tests + spec + gate.** Update `features/012` and interim-host spec
  notes (remove keyboard entry, hints-never-fail, engine-after-finish,
  in-list result, timer setting); deterministic component tests incl. a11y
  announcements; keep domain/repo untouched. Full gate (verify-gate skill);
  commit with owner.

## 6. New/changed testids (contract)

`solve-movelist`, `solve-movelist-status` ("{color} to move…"), `solve-hint`,
`solve-solution`, `solve-restart`, `solve-result` (text Success / Solved with
hints / Failed), `solve-engine-toggle`, `solve-next`, `solve-clock` (timer,
hidden when setting off), `setting-puzzle-timer`. Removed: `KeyboardMoveEntry`
testids, counters (`outcome-wrong/hints` etc.) — verify no other test depends
on removed ones.

## 7. Risks / notes

- Do not regress Review/Live: any `MoveList` change is behind a default-off
  prop; engine wiring is scoped to finished puzzles only.
- `usePuzzleSolve` stage names (`outcome`/`postSolve`) may be collapsed to
  `finished` for the single-view model; keep the recorder write protocol
  (write-failure retryable state) intact.
- The "position the engine analyzes" depends on the finish kind (played
  solution end on success/solved-with-hints/give-up-via-solution) — engine FEN
  = end of the line actually on the board. Hints never fail the puzzle.
- Delete any `zz-*` scratch files before commit; kill dev servers by PID.
