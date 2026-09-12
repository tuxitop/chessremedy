import { useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { difficultyBucketOf, puzzleIdOf, puzzleObjectiveLabel } from '@/domain/puzzle';
import type { PuzzleRow } from '@/domain/puzzle';
import { isLegitimateFirstTry, masteredPuzzleIds } from '@/domain/training';
import { attemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import { trainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import type { TrainingCyclesRepository } from '@/infrastructure/db/training-cycles-repository';
import styles from './MasteredPuzzlesPage.module.css';

/** One mastered puzzle plus its qualifying distinct-cycle count. */
interface MasteredPuzzleItem {
  readonly row: PuzzleRow;
  readonly id: string;
  /** Number of distinct cycles with a legitimate first-try solve (≥ 3). */
  readonly cycleCount: number;
}

export interface MasteredPuzzlesPageProps {
  /** Injectable for tests; defaults to the singleton repository. */
  readonly puzzles?: PuzzlesRepository;
  /** Injectable for tests; defaults to the singleton repository. */
  readonly attempts?: PuzzleAttemptsRepository;
  /** Injectable for tests; defaults to the singleton repository. */
  readonly cycles?: TrainingCyclesRepository;
}

/**
 * The read-only mastered-puzzles list (`/training/mastered`): every puzzle that
 * has earned mastery (a legitimate first-try solve in 3 distinct cycles) with
 * its provenance, objective, difficulty bucket and qualifying cycle count.
 * Mastery is monotonic, so there is deliberately no un-master action.
 */
export function MasteredPuzzlesPage({
  puzzles: providedPuzzles,
  attempts: providedAttempts,
  cycles: providedCycles,
}: MasteredPuzzlesPageProps = {}): React.JSX.Element {
  const puzzlesRepo = providedPuzzles ?? puzzlesRepository;
  const attemptsRepo = providedAttempts ?? attemptsRepository;
  const cyclesRepo = providedCycles ?? trainingCyclesRepository;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<readonly MasteredPuzzleItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [attempts, cycles] = await Promise.all([
          attemptsRepo.listAll(),
          cyclesRepo.listAll(),
        ]);
        const mastered = masteredPuzzleIds(attempts, cycles);
        if (mastered.size === 0) {
          if (!cancelled) {
            setItems([]);
            setError(null);
            setLoading(false);
          }
          return;
        }
        const rows = await puzzlesRepo.getPuzzles([...mastered]);
        const knownCycleIds = new Set(cycles.map((cycle) => cycle.id));
        const cycleCounts = new Map<string, Set<string>>();
        for (const attempt of attempts) {
          if (
            !mastered.has(attempt.puzzleId) ||
            !isLegitimateFirstTry(attempt) ||
            !knownCycleIds.has(attempt.cycleId)
          ) {
            continue;
          }
          let cyclesForPuzzle = cycleCounts.get(attempt.puzzleId);
          if (cyclesForPuzzle === undefined) {
            cyclesForPuzzle = new Set<string>();
            cycleCounts.set(attempt.puzzleId, cyclesForPuzzle);
          }
          cyclesForPuzzle.add(attempt.cycleId);
        }
        const next = rows
          .map((row): MasteredPuzzleItem => {
            const id = puzzleIdOf(row.sourceGameId, row.sourcePly);
            return { row, id, cycleCount: cycleCounts.get(id)?.size ?? 0 };
          })
          .sort(
            (a, b) =>
              a.row.sourceGameId.localeCompare(b.row.sourceGameId) ||
              a.row.sourcePly - b.row.sourcePly,
          );
        if (!cancelled) {
          setItems(next);
          setError(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Could not load your mastered puzzles from local storage.');
          setItems([]);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [puzzlesRepo, attemptsRepo, cyclesRepo]);

  const countLabel = useMemo(() => {
    if (items.length === 0) {
      return null;
    }
    return `${items.length} mastered ${items.length === 1 ? 'puzzle' : 'puzzles'}`;
  }, [items.length]);

  return (
    <div className={styles.page} data-testid="mastered-puzzles">
      <header className={styles.header}>
        <div>
          <Link
            className={styles.backLink}
            to={ROUTES.training}
            data-testid="mastered-puzzles-back"
          >
            ← Training
          </Link>
          <h1 className={styles.heading}>Mastered puzzles</h1>
          <p className={styles.subtitle}>
            A puzzle is mastered after a clean first-try solve in 3 different cycles. Mastery is
            permanent, so this list is read-only.
          </p>
        </div>
      </header>

      {loading ? (
        <p className={styles.state} data-testid="mastered-puzzles-loading">
          Loading mastered puzzles…
        </p>
      ) : error !== null ? (
        <section className={styles.statePanel} role="alert" data-testid="mastered-puzzles-error">
          <p className={styles.state}>{error}</p>
        </section>
      ) : items.length === 0 ? (
        <section
          className={styles.statePanel}
          data-testid="mastered-puzzles-empty"
          aria-labelledby="mastered-puzzles-empty-title"
        >
          <h2 className={styles.stateTitle} id="mastered-puzzles-empty-title">
            No mastered puzzles yet
          </h2>
          <p className={styles.state}>
            Solve a puzzle cleanly, with no hints, wrong moves or restarts, in 3 different cycles to
            master it. Train a set to start earning mastery.
          </p>
          <Link
            className={styles.primaryLink}
            to={ROUTES.training}
            data-testid="mastered-puzzles-empty-training-link"
          >
            Go to Training
          </Link>
        </section>
      ) : (
        <section aria-labelledby="mastered-puzzles-list-title">
          <h2 className={styles.sectionTitle} id="mastered-puzzles-list-title">
            {countLabel}
          </h2>
          <ul className={styles.list} data-testid="mastered-puzzles-list">
            {items.map((item) => (
              <MasteredPuzzleCard key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One read-only mastered-puzzle card. */
function MasteredPuzzleCard({ item }: { readonly item: MasteredPuzzleItem }): React.JSX.Element {
  const { row, id, cycleCount } = item;
  const bucket = difficultyBucketOf(row.difficulty);
  const objective = puzzleObjectiveLabel(row);
  const origin = row.origin === 'blunder' ? 'Blunder' : 'Tactical';
  return (
    <li className={styles.item} data-testid={`mastered-puzzle-${id}`}>
      <h3 className={styles.itemTitle} data-testid={`mastered-puzzle-provenance-${id}`}>
        {row.sourceGameId} · ply {row.sourcePly}
      </h3>
      <dl className={styles.facts}>
        <div className={styles.row}>
          <dt>Origin</dt>
          <dd data-testid={`mastered-puzzle-origin-${id}`}>{origin}</dd>
        </div>
        <div className={styles.row}>
          <dt>Objective</dt>
          <dd data-testid={`mastered-puzzle-objective-${id}`}>{objective}</dd>
        </div>
        <div className={styles.row}>
          <dt>Difficulty</dt>
          <dd data-testid={`mastered-puzzle-difficulty-${id}`}>
            {bucket.name} · {row.difficulty}
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Mastery</dt>
          <dd data-testid={`mastered-puzzle-cycles-${id}`}>
            {cycleCount} distinct {cycleCount === 1 ? 'cycle' : 'cycles'}
          </dd>
        </div>
      </dl>
      <Link
        className={styles.sourceLink}
        to={`/games/${encodeURIComponent(row.sourceGameId)}/puzzles`}
        data-testid={`mastered-puzzle-game-link-${id}`}
      >
        View source game puzzles
      </Link>
    </li>
  );
}
