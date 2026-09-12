import { describe, expect, it } from 'vitest';
import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import { DETECTION_VERSION } from '@/domain/tactics/types';
import { MASTERY_VERSION } from '@/domain/training/mastery';
import { buildVersionSummary } from '../version';
import { STATISTICS_VERSION } from '../types';
import { detectionStatesScenario, mixedVersionsScenario, oneAnalyzedScenario } from './scenarios';

describe('buildVersionSummary', () => {
  it('labels mixed engine and classification versions (ADR-020)', () => {
    const { jobs, summaries } = mixedVersionsScenario();
    const version = buildVersionSummary(jobs, summaries);
    expect(version.engines).toHaveLength(2);
    expect(version.mixedEngineVersions).toBe(true);
    expect(version.mixedClassificationVersions).toBe(true);
    expect(version.classificationVersion).toEqual([
      CLASSIFICATION_VERSION,
      CLASSIFICATION_VERSION + 1,
    ]);
    expect(version.statisticsVersion).toBe(STATISTICS_VERSION);
    expect(version.masteryVersion).toBe(MASTERY_VERSION);
  });

  it('reports a single engine/classification as unmixed', () => {
    const { jobs, summaries } = oneAnalyzedScenario();
    const version = buildVersionSummary(jobs, summaries);
    expect(version.engines).toHaveLength(1);
    expect(version.mixedEngineVersions).toBe(false);
    expect(version.mixedClassificationVersions).toBe(false);
  });

  it('collects distinct detection versions from the contributing summaries', () => {
    const { jobs, summaries } = detectionStatesScenario();
    const version = buildVersionSummary(jobs, summaries);
    expect(version.detectionVersion).toEqual([DETECTION_VERSION - 1, DETECTION_VERSION]);
  });
});
