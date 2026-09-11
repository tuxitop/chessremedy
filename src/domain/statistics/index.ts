/**
 * Feature 014 — statistics/history domain barrel.
 *
 * Pure, deterministic, framework-agnostic aggregation over persisted
 * analysis and game data. No React, Dexie, Worker or engine import.
 */

export * from './types';
export * from './aggregate';
export * from './query';
export * from './eligibility';
export * from './history';
export * from './gameMetrics';
export * from './version';
export * from './phase';
export * from './periods';
export * from './trends';
export * from './rating';
export * from './training';
export * from './compute';
