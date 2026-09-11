/**
 * Feature 014 — contributing-version summary (pure).
 *
 * Collects the distinct pipeline/classification/phase/detection versions and
 * engine identities that produced the contributing analyses and labels mixed
 * engine/classification sets (ADR-020: label, never silently mix). The
 * canonical `MASTERY_VERSION` is surfaced for training aggregates.
 *
 * No React, Dexie, Worker or engine import.
 */

import type { AnalysisJob } from '@/domain/analysis/job';
import type { MoveAnalysis } from '@/domain/chess/analysis';
import { MASTERY_VERSION } from '@/domain/training/mastery';
import type { EngineIdentitySummary, StatisticsAnalysisSummary, VersionSummary } from './types';
import { STATISTICS_VERSION } from './types';

function distinctSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function engineKey(engine: EngineIdentitySummary): string {
  return `${engine.engineName}\u0000${engine.engineVersion}\u0000${engine.engineBuild}`;
}

/**
 * Build the version summary for the contributing set. `jobs` carries the
 * analysis/classification/phase versions and engine identities; `summaries`
 * and `records` carry the detection version of completed passes.
 */
export function buildVersionSummary(
  jobs: readonly AnalysisJob[] = [],
  summaries: readonly StatisticsAnalysisSummary[] = [],
  records: readonly MoveAnalysis[] = [],
): VersionSummary {
  const analysisVersion = distinctSorted(jobs.map((job) => job.analysisVersion));
  const classificationVersion = distinctSorted(jobs.map((job) => job.classificationVersion));
  const gamePhaseVersion = distinctSorted(jobs.map((job) => job.gamePhaseVersion));
  const detectionVersion = distinctSorted([
    ...summaries
      .map((summary) => summary.detectionVersion)
      .filter((version): version is number => version !== null),
    ...records
      .map((record) => record.detectionVersion)
      .filter((version): version is number => version !== null),
  ]);

  const engineMap = new Map<string, EngineIdentitySummary>();
  for (const job of jobs) {
    const engine: EngineIdentitySummary = {
      engineName: job.engine.engineName,
      engineVersion: job.engine.engineVersion,
      engineBuild: job.engine.engineBuild,
    };
    engineMap.set(engineKey(engine), engine);
  }
  const engines = [...engineMap.values()].sort(
    (a, b) =>
      compareText(a.engineName, b.engineName) ||
      compareText(a.engineVersion, b.engineVersion) ||
      compareText(a.engineBuild, b.engineBuild),
  );

  return {
    analysisVersion,
    classificationVersion,
    gamePhaseVersion,
    detectionVersion,
    engines,
    statisticsVersion: STATISTICS_VERSION,
    masteryVersion: MASTERY_VERSION,
    mixedEngineVersions: engines.length > 1,
    mixedClassificationVersions: classificationVersion.length > 1,
  };
}
