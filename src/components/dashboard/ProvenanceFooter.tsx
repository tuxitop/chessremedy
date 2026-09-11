import type * as React from 'react';
import { Link } from 'react-router-dom';
import type { VersionSummary } from '@/domain/statistics';
import { summarizeProvenance } from '@/presentation/dashboard';
import styles from './ProvenanceFooter.module.css';

export interface ProvenanceFooterProps {
  /** The Feature-014 `VersionSummary` of the loaded game metrics, or `null`. */
  readonly versions: VersionSummary | null;
  /** The result's reported statistics version, or `null`. */
  readonly statisticsVersion: number | null;
  readonly testId?: string;
}

function formatVersions(versions: readonly number[]): string {
  return versions.length === 0 ? '—' : versions.join(', ');
}

/**
 * ADR-020 provenance footer: the statistics version, the contributing
 * analysis/classification/game-phase/detection versions and engine identities,
 * plus explicit mixed/outdated labels. It labels the data; it never silently
 * mixes it and never triggers re-analysis (the Game Library link is opt-in).
 */
export function ProvenanceFooter({
  versions,
  statisticsVersion,
  testId = 'provenance-footer',
}: ProvenanceFooterProps): React.JSX.Element | null {
  if (versions === null || statisticsVersion === null) {
    return null;
  }
  const summary = summarizeProvenance(versions, statisticsVersion);
  const mixedLabels = [
    summary.mixedEngineVersions ? 'engine versions' : null,
    summary.mixedClassificationVersions ? 'classification versions' : null,
  ].filter((label): label is string => label !== null);

  return (
    <footer className={styles.footer} aria-label="Data provenance" data-testid={testId}>
      <h2 className={styles.title}>Data provenance</h2>
      <dl className={styles.list}>
        <div className={styles.row}>
          <dt className={styles.term}>Statistics version</dt>
          <dd className={styles.value} data-testid={`${testId}-statistics-version`}>
            {summary.statisticsVersion}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Analysis</dt>
          <dd className={styles.value} data-testid={`${testId}-analysis`}>
            {formatVersions(summary.analysisVersions)}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Classification</dt>
          <dd className={styles.value} data-testid={`${testId}-classification`}>
            {formatVersions(summary.classificationVersions)}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Game phase</dt>
          <dd className={styles.value} data-testid={`${testId}-game-phase`}>
            {formatVersions(summary.gamePhaseVersions)}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Detection</dt>
          <dd className={styles.value} data-testid={`${testId}-detection`}>
            {formatVersions(summary.detectionVersions)}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Engines</dt>
          <dd className={styles.value} data-testid={`${testId}-engines`}>
            {summary.engineLabels.length === 0 ? '—' : summary.engineLabels.join(', ')}
          </dd>
        </div>
      </dl>

      {mixedLabels.length > 0 ? (
        <p className={styles.flags} data-testid={`${testId}-mixed`}>
          Mixed data: multiple {mixedLabels.join(' and ')} are present. Values are shown per
          partition and are never silently combined.
        </p>
      ) : null}

      {summary.outdated ? (
        <p className={styles.outdated} data-testid={`${testId}-outdated`}>
          Some games were analyzed with an older{' '}
          {summary.outdatedAnalysis ? 'analysis' : 'classification'} version.{' '}
          <Link className={styles.link} to="/games">
            Re-analyze from the Game Library
          </Link>{' '}
          to update them. The Dashboard never triggers re-analysis.
        </p>
      ) : null}
    </footer>
  );
}
