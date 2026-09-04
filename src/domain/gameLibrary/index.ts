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
import type { TimeControlCategory } from '@/domain/chess/timeControl';

/** Minimal row read-model. `GameSummary` maps onto it structurally. */
export interface LibraryGameRow {
  readonly id: string;
  readonly source: GameSource;
  readonly externalId: string | null;
  /** ISO-8601 UTC instant, or null. */
  readonly playedAt: string | null;
  readonly whiteName: string;
  readonly blackName: string;
  readonly result: GameResult;
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
  readonly whitePlayer: { readonly name: string };
  readonly blackPlayer: { readonly name: string };
  readonly result: GameResult;
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
    result: summary.result,
    timeControl: summary.timeControl,
    normalizedTimeControl: summary.normalizedTimeControl,
    userColor: summary.userColor,
  };
}

export * from './timeframe';
export * from './filters';
export * from './search';
export * from './predicates';
export * from './selection';
export * from './sort';
export * from './rowView';
