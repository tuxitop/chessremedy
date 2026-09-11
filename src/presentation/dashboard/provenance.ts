/**
 * Feature 015 — provenance summary (pure, no React).
 *
 * Formats a Feature-014 `VersionSummary` for the ADR-020 provenance footer and
 * derives the `outdated` label by comparing the reported analysis/
 * classification versions against the current pipeline constants. This is a
 * presentation comparison only: it computes no statistic and mutates nothing.
 */

import { ANALYSIS_VERSION } from '@/domain/chess/analysis';
import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import type { EngineIdentitySummary, VersionSummary } from '@/domain/statistics';

/** Presentation-ready provenance summary. */
export interface ProvenanceSummary {
  readonly statisticsVersion: number;
  readonly analysisVersions: readonly number[];
  readonly classificationVersions: readonly number[];
  readonly gamePhaseVersions: readonly number[];
  readonly detectionVersions: readonly number[];
  readonly engineLabels: readonly string[];
  readonly mixedEngineVersions: boolean;
  readonly mixedClassificationVersions: boolean;
  /** True when any reported analysis/classification version predates current. */
  readonly outdated: boolean;
  readonly outdatedAnalysis: boolean;
  readonly outdatedClassification: boolean;
}

/** Human label of one engine identity (name, version, build). */
export function engineIdentityLabel(engine: EngineIdentitySummary): string {
  return [engine.engineName, engine.engineVersion, engine.engineBuild]
    .filter((part) => part.trim() !== '')
    .join(' ');
}

/** True when the reported analysis or classification version predates current. */
export function isOutdated(versions: VersionSummary): boolean {
  return (
    versions.analysisVersion.some((version) => version < ANALYSIS_VERSION) ||
    versions.classificationVersion.some((version) => version < CLASSIFICATION_VERSION)
  );
}

/**
 * Summarize the contributing versions for display. `statisticsVersion` is the
 * result's reported statistics version (may differ from the summary's own
 * field); every other value is read verbatim from the `VersionSummary`.
 */
export function summarizeProvenance(
  versions: VersionSummary,
  statisticsVersion: number,
): ProvenanceSummary {
  const outdatedAnalysis = versions.analysisVersion.some((version) => version < ANALYSIS_VERSION);
  const outdatedClassification = versions.classificationVersion.some(
    (version) => version < CLASSIFICATION_VERSION,
  );
  return {
    statisticsVersion,
    analysisVersions: [...versions.analysisVersion],
    classificationVersions: [...versions.classificationVersion],
    gamePhaseVersions: [...versions.gamePhaseVersion],
    detectionVersions: [...versions.detectionVersion],
    engineLabels: versions.engines.map(engineIdentityLabel),
    mixedEngineVersions: versions.mixedEngineVersions,
    mixedClassificationVersions: versions.mixedClassificationVersions,
    outdated: outdatedAnalysis || outdatedClassification,
    outdatedAnalysis,
    outdatedClassification,
  };
}
