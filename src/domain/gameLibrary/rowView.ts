/**
 * Game Library row extensibility (Feature 007).
 *
 * Future features (008 bulk/review + analysis status, 009 classification
 * counts/accuracy, 010 missed tactics, 011 puzzles-from-game, 012/013/014
 * mastered counts) plug into per-row **insights** and per-row **actions**
 * through capability keys. V1 registers only `delete`; insights are absent
 * until an owner feature supplies values. The Library renders present
 * values read-only and never computes them.
 *
 * The analysis-result fields (`analysisStatus`, `accuracy`,
 *  `classificationCounts`, `detectionState`, `detectionVersion`,
 *  `missedTactics`, `hasCompletedDetection`, `scanProgress`) are
 *  supplied by the Feature-010 Game Library milestone over persisted
 *  analysis jobs + per-analysis summaries (specs/domain/game-library.md §7):
 *  values are user-side, derive from the latest completed analysis, and
 *  follow the absent-vs-zero contract (`missedTactics` is `null` until a
 *  detection pass completed and `undefined` when no completed analysis
 *  exists; `0` is a real zero).
 *
 *  The puzzle fields (`puzzleState`, `puzzleProgress`, `puzzleCount`) are
 *  Feature-011's addition (features/011-puzzle-generation.md "Game Library
 *  integration"). They follow the same absent-vs-zero discipline as the
 *  missed-tactic fields and are only meaningful once the latest completed
 *  analysis's detection pass is `completed` at the current pipeline version
 *  (plan-015 freshness gate): a stale completed detection suppresses the
 *  puzzle count/state notes with the Feature-010 "out of date" note.
 *  `puzzleCount` is the persisted `puzzles`-table row count of the game and
 *  is exposed **only** when the generation pass `completed` (a real `0`
 *  reads green); every other state exposes no number, only the state note.
 *  `puzzleState`/`puzzleProgress` let the row render the truthful note and
 *  the live "generating…" bar while a pass is genuinely running.
 */

import type { GameAnalysisStatus } from '@/domain/analysis';
import type { ClassificationCounts } from '@/domain/analysis/summary';
import type {
  ScanProgress,
  SummaryDetectionState,
  SummaryPuzzleState,
} from '@/domain/analysis/summaryDerivation';

export type GameActionCapability = 'liveAnalysis' | 'review' | 'puzzles' | 'delete';

export type GameInsightCapability =
  | 'accuracy'
  | 'analysisStatus'
  | 'classificationCounts'
  | 'missedTactics'
  | 'puzzleCount'
  | 'masteredPuzzleCount';

export interface GameRowInsights {
  /** ADR-024 user per-game accuracy; `null` = no usable user move (em-dash). */
  readonly accuracy?: number | null;
  /** Feature-008 analysis status over the game's persisted jobs. */
  readonly analysisStatus?: GameAnalysisStatus;
  /** User-side ADR-023 counts of the latest completed analysis. */
  readonly classificationCounts?: Readonly<ClassificationCounts>;
  /**
   * Detection-pass state of the latest completed analysis (Feature 010):
   * `'completed'` means `missedTactics` is a real number (zero included);
   * `'absent'` = never scanned, `'queued'`/`'inProgress'` = scanning,
   * `'failed'` = a scan attempt ended. Exposed so a row can say "not scanned"
   * instead of silently showing nothing.
   */
  readonly detectionState?: SummaryDetectionState;
  /**
   * Detection-pipeline version that produced the row's completed pass
   * (Feature 010, plan 015). Absent until a pass completed. A completed
   * `detectionState` whose version differs from the current constant is
   * **outdated**: its missed-tactic result must not be rendered/counted and
   * the row should offer a refresh scan.
   */
  readonly detectionVersion?: number | null;
  /** True once a Feature-010 detection pass completed for the analysis. */
  readonly hasCompletedDetection?: boolean;
  /**
   * User missed-tactic count of a completed detection pass (`0` is real);
   * `null` until the pass completed; absent when no completed analysis.
   */
  readonly missedTactics?: number | null;
  /**
   * Live Stage-2 scan progress (`done`/`total` settled candidates) of the
   * latest completed analysis's detection pass (plan 013 W3). Absent/`null` on
   * rows whose pass has not recorded progress. The Library renders a progress
   * bar from this value only while the shared service reports the game as
   * live — it never claims progress for an interrupted pass.
   */
  readonly scanProgress?: { readonly done: number; readonly total: number } | null;
  /**
   * Puzzle-generation state of the latest completed analysis's generation pass
   * (Feature 011): `'completed'` means `puzzleCount` is a real number (zero
   * included); `'absent'` = never generated, `'queued'`/`'inProgress'` =
   * generating, `'failed'` = a generation attempt ended. Exposed so a row can
   * say "Puzzles not generated" instead of silently showing nothing. Only
   * rendered once the analysis's detection pass completed at the current
   * version (see the module header).
   */
  readonly puzzleState?: SummaryPuzzleState;
  /**
   * Puzzle-generator version of the latest completed analysis's completed
   * generation pass (Feature 011 regeneration); `null` until one completes and
   * only meaningful when `puzzleState` is `'completed'`. A completed pass whose
   * version differs from the current `PUZZLE_GENERATOR_VERSION` constant is
   * **outdated**: its rows stay visible and immutable, but the row offers the
   * engine-free "Regenerate puzzles" action to add the newer row kinds (e.g.
   * one-move blunder puzzles).
   */
  readonly puzzleGeneratorVersion?: number | null;
  /**
   * Live generation progress (`done`/`total` puzzles assembled/written) of the
   * latest completed analysis's generation pass. Absent/`null` on rows whose
   * pass has not recorded progress. The Library renders a progress bar from
   * this value only while the shared service reports the game as live — it
   * never claims progress for an interrupted pass.
   */
  readonly puzzleProgress?: ScanProgress | null;
  /**
   * The game's persisted `puzzles`-table row count (Feature 011) — a
   * repository count over the game-scoped index, never a `MoveAnalysis`/
   * candidate scan. Exposed **only** when the latest completed analysis's
   * generation pass `completed` (with a current detection pass): `0` is a real
   * zero, every other state exposes no value so the row renders the state note
   * instead (absent ≠ zero, mirror of `missedTactics`).
   */
  readonly puzzleCount?: number;
  /**
   * Feature-013/014 mastered-puzzle aggregate over the Feature-012
   * `puzzleAttempts` rows (that table is the source; Feature 012 itself
   * never computes this — the Library stays a read model here).
   */
  readonly masteredPuzzleCount?: number;
}

export interface GameRowAction {
  readonly capability: GameActionCapability;
  readonly label: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}

/** Actions a feature may register for a row; V1 ships only `delete`. */
export const ROW_ACTIONS_BY_CAPABILITY: readonly GameActionCapability[] = ['delete'];
