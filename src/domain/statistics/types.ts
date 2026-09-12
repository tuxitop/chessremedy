/**
 * Feature 014 — statistics domain contracts (pure).
 *
 * The canonical, framework-free vocabulary for the statistics/history layer:
 * the query/dimension model, the metric result contract
 * (`ok | insufficient | empty | notDetected` with an honest `n`), the
 * per-game history read model, aggregate groups, period/trend and rating
 * types, the contributing-version summary and the diagnostics counters.
 *
 * No React, Dexie, Worker or network import lives here; every value type is
 * sourced from the existing canonical domain models (`@/domain/chess`,
 * `@/domain/analysis`, `@/domain/gameLibrary`) and never redefined.
 */

import type { Color } from 'chessops/types';
import type { GameId, GameOutcome, GameResult } from '@/domain/chess/game';
import type { GameSource } from '@/domain/chess/gameSource';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { GamePhase } from '@/domain/chess/analysis';
import type { ClassificationCounts } from '@/domain/analysis/summary';
import type { GameAnalysisStatus } from '@/domain/analysis/status';
import type { SummaryDetectionState } from '@/domain/analysis/summaryDerivation';
import type { TimeFrame } from '@/domain/gameLibrary/timeframe';

/** Canonical date-range model — an alias of the Game Library `TimeFrame`. */
export type StatisticsDateRange = TimeFrame;

/**
 * Reliability state of every scalar aggregate (`domain/statistics.md`,
 * ADR-013):
 * - `ok` — value computed and `sample.n >= MIN_SAMPLE_SIZE`;
 * - `insufficient` — value computed but `0 < n < MIN_SAMPLE_SIZE`;
 * - `empty` — no applicable observations, `value` is `null`;
 * - `notDetected` — a missed-tactic metric with no current completed
 *   detection pass, `value` is `null` (absent ≠ zero).
 */
export type MetricState = 'ok' | 'insufficient' | 'empty' | 'notDetected';

/** Unit the sample size of an aggregate is expressed in. */
export type SampleUnit = 'games' | 'moves' | 'puzzles' | 'cycles';

/** Sample-size metadata carried by every aggregate. */
export interface Sample {
  readonly unit: SampleUnit;
  readonly n: number;
}

/** Canonical scalar aggregate result (`features/014` §3). */
export interface Aggregate {
  /** Raw, full-precision value; `null` for `empty`/`notDetected`. */
  readonly value: number | null;
  readonly state: MetricState;
  readonly sample: Sample;
}

/** Move-weighted accuracy aggregate; exposes its weighting denominator. */
export interface AccuracyAggregate extends Aggregate {
  /** `Σ accuracyMoves` over the games that contributed a non-null accuracy. */
  readonly weightMoves: number;
}

/** Canonical minimum sample size (`domain/statistics.md`, ADR-013). */
export const MIN_SAMPLE_SIZE = 5;

/**
 * Version of the aggregation semantics (bumped on any semantic change).
 *
 * Version 2 (plan 009 W3, ADR-023 amendment) adds **missed-tactic
 * exclusivity**: a current-version verified missed-tactic ply is excluded from
 * the classification/error counts, per-game rates/shares and phase error
 * numerators (it is counted only in the missed-tactic metrics), while the
 * move-exposure denominators and the ADR-024 accuracy weight keep it.
 *
 * Version 3 (plan 013 W5, ADR-013 revision) makes the canonical time-control
 * category **platform-specific**: a partition is `(platform, category)` and the
 * same raw clock may fall into different categories per platform (`5|5` is
 * Lichess `rapid`, Chess.com `blitz`; Chess.com has no `classical`). Both
 * changes are recorded here as the version provenance.
 */
export const STATISTICS_VERSION = 3;

/** Platform dimension; `fixture` is test-only and never a production result. */
export type PlatformDimension = 'all' | GameSource;

/** Time-control dimension (the six ADR-013 categories). */
export type TimeControlDimension = 'all' | TimeControlCategory;

/** User-side dimension. */
export type SideDimension = 'all' | Color;

/** Result dimension (canonical `GameOutcome`). */
export type ResultDimension = 'all' | GameOutcome;

/**
 * Statistics query over the canonical dimensions. Dimensions combine with
 * AND; `combine` is an explicit merge request (default `false`).
 */
export interface StatisticsQuery {
  readonly platform: PlatformDimension;
  readonly timeControl: TimeControlDimension;
  readonly side: SideDimension;
  readonly result: ResultDimension;
  readonly dateRange: StatisticsDateRange;
  /** Caller-supplied epoch ms (preset resolution + determinism). */
  readonly now: number;
  /** Explicit merge request; never silently defaults to combining. */
  readonly combine?: boolean;
}

/** Minimal game read model the pure statistics functions consume. */
export interface StatisticsGameRow {
  readonly id: GameId;
  readonly source: GameSource;
  /** ISO-8601 UTC instant, or `null` when unknown. */
  readonly playedAt: string | null;
  readonly normalizedTimeControl: TimeControlCategory;
  readonly userColor: Color;
  readonly result: GameResult;
  /** The user's stored `Player.rating`, or `null` when unknown. */
  readonly userRating: number | null;
}

/**
 * The subset of the persisted per-analysis summary the statistics layer reads.
 * Structurally satisfied by the infrastructure `AnalysisSummaryRow`, so the
 * application service can pass rows without mapping.
 */
export interface StatisticsAnalysisSummary {
  readonly analysisId: string;
  readonly gameId: GameId;
  readonly accuracy: number | null;
  readonly accuracyMoves: number;
  readonly classificationCounts: ClassificationCounts;
  readonly userMoves: number;
  readonly detectionState: SummaryDetectionState;
  /** `null` until a detection pass completed (absent ≠ zero). */
  readonly missedTacticCount: number | null;
  readonly detectionVersion: number | null;
}

/**
 * Per-game history read model (`features/014` §4). One entry per game with
 * its eligibility/analysis/detection status; aggregates trace back to it.
 */
export interface GameHistoryEntry {
  readonly gameId: GameId;
  readonly playedAt: string | null;
  readonly source: GameSource;
  readonly normalizedTimeControl: TimeControlCategory;
  readonly userColor: Color;
  readonly outcome: GameOutcome;
  readonly userRating: number | null;
  /** Eligible analysis identity, or `null` when none exists. */
  readonly analysisId: string | null;
  readonly analysisStatus: GameAnalysisStatus;
  /** Persisted ADR-024 per-game accuracy (read, never recomputed). */
  readonly accuracy: number | null;
  readonly accuracyMoves: number;
  /** User-side classification counts, or `null` without an eligible analysis. */
  readonly classificationCounts: ClassificationCounts | null;
  /** `null` until a current completed detection pass; `0` is a real zero. */
  readonly missedTactics: number | null;
}

/** Game denominators/diagnostics surfaced with every metrics result. */
export interface GamesCounts {
  readonly total: number;
  readonly analyzed: number;
  readonly detected: number;
  readonly missingSummary: number;
  readonly pendingAnalysis: number;
  readonly undated: number;
}

/** User-side classification aggregates. */
export interface ClassificationMetrics {
  readonly inaccuracies: Aggregate;
  readonly mistakes: Aggregate;
  readonly blunders: Aggregate;
  readonly inaccuraciesPerGame: Aggregate;
  readonly mistakesPerGame: Aggregate;
  readonly blundersPerGame: Aggregate;
  readonly medianBlundersPerGame: Aggregate;
  readonly medianMistakesPerGame: Aggregate;
  readonly gamesWithBlunderShare: Aggregate;
  readonly gamesWithMistakeShare: Aggregate;
}

/** User-side missed-tactic aggregates (sample unit `games`, detected). */
export interface MissedTacticMetrics {
  readonly missedTactics: Aggregate;
  readonly missedTacticsPerGame: Aggregate;
  readonly gamesWithMissedTacticShare: Aggregate;
}

/** Canonical game-analysis aggregate group. */
export interface GameMetrics {
  readonly games: GamesCounts;
  readonly classification: ClassificationMetrics;
  readonly missedTactics: MissedTacticMetrics;
  readonly accuracy: AccuracyAggregate;
}

/** Counts for one negative class (and missed tactics) within one phase. */
export interface PhaseMetricCounts {
  readonly inaccuracies: Aggregate;
  readonly mistakes: Aggregate;
  readonly blunders: Aggregate;
  readonly missedTactics: Aggregate;
}

/**
 * Per-phase aggregate group (types only in Stage A; `phase.ts` implements it
 * in Stage B). Counts use the analyzed-games sample (detected games for
 * missed tactics); normalized rates use the per-phase user-move sample.
 */
export interface PhaseMetrics {
  readonly phase: GamePhase;
  readonly userMovesInPhase: number;
  readonly detectedUserMovesInPhase: number;
  readonly counts: PhaseMetricCounts;
  readonly errorsPer100Moves: PhaseMetricCounts;
}

/** Engine identity without the profile (ADR-020 mixing key). */
export interface EngineIdentitySummary {
  readonly engineName: string;
  readonly engineVersion: string;
  readonly engineBuild: string;
}

/**
 * Contributing-version provenance (ADR-020: label, never silently mix).
 * Version fields are the distinct values present in the contributing set.
 */
export interface VersionSummary {
  readonly analysisVersion: readonly number[];
  readonly classificationVersion: readonly number[];
  readonly gamePhaseVersion: readonly number[];
  readonly detectionVersion: readonly number[];
  readonly engines: readonly EngineIdentitySummary[];
  readonly statisticsVersion: number;
  readonly masteryVersion: number;
  readonly mixedEngineVersions: boolean;
  readonly mixedClassificationVersions: boolean;
}

/** Diagnostics counters (never errors). */
export interface StatisticsDiagnostics {
  readonly missingSummary: number;
  readonly pendingAnalysis: number;
  readonly undated: number;
  readonly orphanedSummaries: number;
  readonly orphanedAttempts: number;
  readonly unrecognizedTimeControls: number;
}

/** Period granularity for trend series. */
export type TrendGranularity = 'day' | 'week' | 'month';

/** Supported trend metrics (`features/014` §7). */
export type TrendMetric =
  | 'gamesPlayed'
  | 'gamesAnalyzed'
  | 'accuracy'
  | 'rating'
  | 'inaccuraciesPerGame'
  | 'mistakesPerGame'
  | 'blundersPerGame'
  | 'missedTacticsPerGame'
  | 'inaccuracies'
  | 'mistakes'
  | 'blunders'
  | 'missedTactics';

/** One period of a trend series; empty periods are explicit gaps. */
export interface TrendPoint {
  readonly periodKey: string;
  /** Inclusive local period start, epoch ms. */
  readonly periodStart: number;
  /** Inclusive local period end, epoch ms. */
  readonly periodEnd: number;
  readonly value: number | null;
  readonly state: MetricState;
  readonly sample: Sample;
}

/** A complete, ascending trend series over every period in the range. */
export interface TrendSeries {
  readonly metric: TrendMetric;
  readonly granularity: TrendGranularity;
  readonly platform: GameSource;
  readonly timeControl: TimeControlCategory;
  readonly points: readonly TrendPoint[];
  readonly statisticsVersion: number;
  readonly versions: VersionSummary;
}

/** One rated game in a rating history. */
export interface RatingPoint {
  readonly gameId: GameId;
  /** ISO-8601 UTC instant; always present (undated games are excluded). */
  readonly playedAt: string;
  readonly rating: number;
}

/** Rating history scoped to one concrete platform + time control. */
export interface RatingHistory {
  readonly platform: GameSource;
  readonly timeControl: TimeControlCategory;
  readonly points: readonly RatingPoint[];
  readonly statisticsVersion: number;
  readonly versions: VersionSummary;
}

/** Metric class for the anti-combination rule. */
export type MetricClass = 'activity' | 'speedSensitive';

/** One concrete `(platform, timeControl)` partition of matching games. */
export interface GamePartition {
  readonly platform: PlatformDimension;
  readonly timeControl: TimeControlDimension;
  /** `true` only for an explicitly requested, allowed merged partition. */
  readonly combined: boolean;
  readonly games: readonly StatisticsGameRow[];
}

/** Typed query-validation failure; never a silent widening. */
export interface StatisticsQueryError {
  readonly ok: false;
  readonly reason: 'invalid-date-range';
  readonly message: string;
}
