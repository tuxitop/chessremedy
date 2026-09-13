import { useMemo } from 'react';
import type * as React from 'react';
import {
  HomeContinueCard,
  HomeHero,
  HomeHowItWorks,
  HomePuzzlePreview,
  HomeQuickNav,
  HomeStatsGrid,
  type HomeHeroPill,
} from '@/components/home';
import { useHome, type UseHomeOptions } from '@/hooks/useHome';
import {
  resolveHomeContinue,
  selectHomePrimaryAction,
  type HomeContinueTarget,
} from '@/presentation/home';
import styles from './HomePage.module.css';

/** Injectable dependencies for deterministic tests (defaults are production). */
export type HomePageProps = UseHomeOptions;

/**
 * The `/` Home landing page: a context-aware hero, a deterministic continue
 * card, four honest at-a-glance stat cards, quick navigation and how-it-works
 * copy, inside the Feature-001 shell. It is presentation/composition only —
 * every value comes from Feature 014 / the canonical Feature 013 mastery
 * through `useHome`; it starts no engine, touches no network and mutates no
 * data. The statistics service is loaded behind a dynamic import.
 */
export function HomePage(props: HomePageProps = {}): React.JSX.Element {
  const home = useHome(props);

  const continueTarget: HomeContinueTarget = useMemo(() => {
    const training = home.training.data;
    if (training === null) {
      return { kind: 'none' };
    }
    return resolveHomeContinue({
      sets: training.sets,
      openBlock: training.openBlock,
      cycles: training.cycles,
    });
  }, [home.training.data]);

  const primaryAction = selectHomePrimaryAction({
    totalGames: home.game.data?.totalGames ?? null,
    hasEligibleAnalysis:
      home.game.data?.partitions.some((partition) => partition.metrics.games.analyzed > 0) ?? false,
    continueTarget,
  });

  const heroPills = useMemo<readonly HomeHeroPill[]>(() => {
    if (continueTarget.kind === 'cycle') {
      return [
        { label: 'Training in progress', tone: 'brand' },
        {
          label: continueTarget.quickTrain ? 'Quick train' : `Cycle ${continueTarget.cycleNumber}`,
          tone: 'neutral',
        },
      ];
    }
    if (continueTarget.kind === 'block') {
      return [{ label: 'Active training block', tone: 'brand' }];
    }
    return [];
  }, [continueTarget]);

  const continueProgress = useMemo<{ completed: number; total: number } | null>(() => {
    if (continueTarget.kind !== 'cycle' || continueTarget.quickTrain) {
      return null;
    }
    const stats = home.block.data?.stats;
    if (stats === undefined || stats.setId !== continueTarget.setId) {
      return null;
    }
    const cycle = stats.currentCycle;
    if (cycle === null || cycle.cycleNumber !== continueTarget.cycleNumber) {
      return null;
    }
    if (stats.puzzleCount <= 0) {
      return null;
    }
    return { completed: cycle.metrics.puzzlesCompleted, total: stats.puzzleCount };
  }, [continueTarget, home.block.data]);

  const loading =
    home.game.loading || home.training.loading || home.mastery.loading || home.block.loading;

  return (
    <div className={styles.page} data-testid="home-page">
      <p className={styles.srOnly} role="status" aria-live="polite" data-testid="home-live">
        {loading ? 'Loading home data…' : 'Home data loaded.'}
      </p>

      <HomeHero
        primaryAction={primaryAction}
        pills={heroPills}
        loading={home.game.loading}
        error={home.game.error}
        onRetry={home.reload}
      />

      <HomeContinueCard target={continueTarget} progress={continueProgress} />

      <HomeStatsGrid
        game={home.game}
        training={home.training}
        mastery={home.mastery}
        block={home.block}
        onRetry={home.reload}
      />

      {home.preview.data !== null ? <HomePuzzlePreview puzzle={home.preview.data} /> : null}

      <HomeQuickNav />

      <HomeHowItWorks />
    </div>
  );
}
