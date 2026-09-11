import type * as React from 'react';
import {
  DashboardFilterBar,
  DashboardGameSection,
  DashboardTrainingSection,
  ProvenanceFooter,
} from '@/components/dashboard';
import { useDashboard, type UseDashboardOptions } from '@/hooks/useDashboard';
import styles from './DashboardPage.module.css';

/** Injectable dependencies for deterministic tests (defaults are production). */
export type DashboardPageProps = UseDashboardOptions;

/**
 * The `/dashboard` page: the game-analysis filter bar and section, the
 * set-scoped training section and the ADR-020 provenance footer. It is
 * presentation only — every value comes from the Feature-014 statistics
 * service through `useDashboard`; it starts no engine, touches no network and
 * mutates no data. Each section keeps its own honest loading/empty/error state
 * so one failed read never blanks the page.
 */
export function DashboardPage(props: DashboardPageProps = {}): React.JSX.Element {
  const dashboard = useDashboard(props);
  const versions = dashboard.game.metrics.data?.versions ?? null;
  const statisticsVersion = dashboard.game.metrics.data?.statisticsVersion ?? null;

  return (
    <div className={styles.page} data-testid="dashboard-page">
      <header className={styles.header}>
        <h1 className={styles.heading}>Dashboard</h1>
        <p className={styles.subtitle}>
          Rating, accuracy, mistakes and training progress. Every value shows its sample size, and
          partitions are never silently combined.
        </p>
      </header>

      <p className={styles.srOnly} role="status" aria-live="polite" data-testid="dashboard-live">
        {dashboard.loading ? 'Loading statistics…' : 'Statistics loaded.'}
      </p>

      <DashboardFilterBar
        filters={dashboard.filters}
        hint={dashboard.hint}
        mixed={dashboard.mixed}
        onFilters={dashboard.updateFilters}
      />

      <DashboardGameSection game={dashboard.game} onRetry={dashboard.reload} />

      <DashboardTrainingSection
        training={dashboard.training}
        onSelectSet={dashboard.selectSet}
        onRetry={dashboard.reload}
      />

      <ProvenanceFooter versions={versions} statisticsVersion={statisticsVersion} />
    </div>
  );
}
