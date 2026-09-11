import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION } from '@/domain/chess/analysis';
import { CLASSIFICATION_VERSION } from '@/domain/chess/classification';
import type { VersionSummary } from '@/domain/statistics';
import { engineIdentityLabel, isOutdated, summarizeProvenance } from './provenance';

function versions(overrides: Partial<VersionSummary> = {}): VersionSummary {
  return {
    analysisVersion: [ANALYSIS_VERSION],
    classificationVersion: [CLASSIFICATION_VERSION],
    gamePhaseVersion: [1],
    detectionVersion: [1],
    engines: [],
    statisticsVersion: 1,
    masteryVersion: 1,
    mixedEngineVersions: false,
    mixedClassificationVersions: false,
    ...overrides,
  };
}

describe('provenance', () => {
  it('is not outdated for the current analysis/classification versions', () => {
    expect(isOutdated(versions())).toBe(false);
  });

  it('is outdated when a reported analysis version predates current', () => {
    expect(isOutdated(versions({ analysisVersion: [ANALYSIS_VERSION - 1] }))).toBe(true);
  });

  it('is outdated when a reported classification version predates current', () => {
    expect(isOutdated(versions({ classificationVersion: [CLASSIFICATION_VERSION - 1] }))).toBe(
      true,
    );
  });

  it('formats engine identities and the mixed flags', () => {
    const summary = summarizeProvenance(
      versions({
        engines: [
          {
            engineName: 'Stockfish',
            engineVersion: '18.0.8',
            engineBuild: 'stockfish-18-lite-single',
          },
        ],
        mixedEngineVersions: true,
        mixedClassificationVersions: true,
      }),
      1,
    );
    expect(summary.engineLabels).toEqual(['Stockfish 18.0.8 stockfish-18-lite-single']);
    expect(summary.mixedEngineVersions).toBe(true);
    expect(summary.mixedClassificationVersions).toBe(true);
    expect(summary.outdated).toBe(false);
    expect(summary.statisticsVersion).toBe(1);
  });

  it('reports the specific outdated dimension', () => {
    const summary = summarizeProvenance(versions({ analysisVersion: [ANALYSIS_VERSION - 1] }), 1);
    expect(summary.outdated).toBe(true);
    expect(summary.outdatedAnalysis).toBe(true);
    expect(summary.outdatedClassification).toBe(false);
  });

  it('joins engine identity parts without empty segments', () => {
    expect(
      engineIdentityLabel({ engineName: 'Stockfish', engineVersion: '', engineBuild: 'lite' }),
    ).toBe('Stockfish lite');
  });
});
