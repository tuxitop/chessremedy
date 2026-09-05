/**
 * Game Library domain model (Feature 007 milestone 2).
 *
 * Pure, framework-agnostic model for browsing imported games. Single
 * canonical filter/search/selection state; local-timezone date rules;
 * row read-model with capability-based insights/actions. No React, Dexie
 * or network dependencies (specs/domain/game-library.md).
 */

import type { Color } from 'chessops/types';
import type { GameSource } from '@/domain/chess/gameSource';
import type { GameResult } from '@/domain/chess/game';
import type { GameTermination } from '@/domain/chess/gameEnd';
import type { TimeControlCategory } from '@/domain/chess/timeControl';
import type { GameRowInsights } from './rowView';

/**
 * Minimal row read-model. `GameSummary` maps onto it structurally. The
 * optional insight fields extend the row read-only: they are never computed
 * here but overlaid by `withRowInsights` from persisted analysis jobs and
 * per-analysis summaries (specs/domain/game-library.md §7), which the strip
 * renders and the analysis-result filters consume.
 */
export interface LibraryGameRow extends GameRowInsights {
  readonly id: string;
  readonly source: GameSource;
  readonly externalId: string | null;
  /** ISO-8601 UTC instant, or null. */
  readonly playedAt: string | null;
  readonly whiteName: string;
  readonly blackName: string;
  readonly whiteRating: number | null;
  readonly blackRating: number | null;
  readonly result: GameResult;
  /** Full-move count of the mainline (schema v6). */
  readonly moveCount: number;
  /** Board-detectable game end, or `null`. */
  readonly termination: GameTermination | null;
  /** Verbatim provider time-control string. */
  readonly timeControl: string;
  readonly normalizedTimeControl: TimeControlCategory;
  readonly userColor: Color;
}

/** Shape that can produce a `LibraryGameRow` (GameSummary-compatible). */
export interface GameSummaryLike {
  readonly id: string;
  readonly source: GameSource;
  readonly externalId: string | null;
  readonly playedAt: string | null;
  readonly whitePlayer: { readonly name: string; readonly rating?: number | null };
  readonly blackPlayer: { readonly name: string; readonly rating?: number | null };
  readonly result: GameResult;
  readonly moveCount: number;
  readonly termination: GameTermination | null;
  readonly timeControl: string;
  readonly normalizedTimeControl: TimeControlCategory;
  readonly userColor: Color;
}

export function libraryRowOf(summary: GameSummaryLike): LibraryGameRow {
  return {
    id: summary.id,
    source: summary.source,
    externalId: summary.externalId,
    playedAt: summary.playedAt,
    whiteName: summary.whitePlayer.name,
    blackName: summary.blackPlayer.name,
    whiteRating: summary.whitePlayer.rating ?? null,
    blackRating: summary.blackPlayer.rating ?? null,
    result: summary.result,
    moveCount: summary.moveCount,
    termination: summary.termination,
    timeControl: summary.timeControl,
    normalizedTimeControl: summary.normalizedTimeControl,
    userColor: summary.userColor,
  };
}

/**
 * Overlay a read-only insights group (analysis status, accuracy, counts,
 * missed tactics) onto a base row. Insights come from the persisted
 * analysis jobs/per-analysis summary of the row's game — never computed by
 * the Library (specs/domain/game-library.md §7).
 */
export function withRowInsights(row: LibraryGameRow, insights: GameRowInsights): LibraryGameRow {
  return { ...row, ...insights };
}

export * from './timeframe';
export * from './filters';
export * from './search';
export * from './predicates';
export * from './selection';
export * from './sort';
export * from './rowView';
