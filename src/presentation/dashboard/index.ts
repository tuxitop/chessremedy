/**
 * Feature 015 — dashboard presentation barrel.
 *
 * Pure, deterministic, framework-agnostic presentation selectors/formatters
 * consumed by the `useDashboard` hook and the dashboard React components. No
 * React, Dexie, Worker, engine, network or Recharts import; no statistics
 * computation (Feature 014 owns every value).
 */

export * from './aggregateDisplay';
export * from './chartPoints';
export * from './formatters';
export * from './labels';
export * from './provenance';
export * from './query';
export * from './selection';
