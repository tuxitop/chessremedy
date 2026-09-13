import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { Chessboard } from '@/components/chessboard/Chessboard';
import { useBoardSize } from '@/components/chessboard/useBoardSize';
import { parsePositionFen } from '@/domain/chess';
import { difficultyBucketOf, puzzleObjectiveLabel, type PuzzleRow } from '@/domain/puzzle';
import styles from './HomePuzzlePreview.module.css';

export interface HomePuzzlePreviewProps {
  /** The puzzle to showcase (the most recently created one). */
  readonly puzzle: PuzzleRow;
}

/**
 * Home showcase: a real, read-only puzzle board with its objective and
 * provenance, plus a link into Training. Mirrors the AI-Studio design's
 * "Live Tactical Companion Preview" without fabricating any data.
 */
export function HomePuzzlePreview({ puzzle }: HomePuzzlePreviewProps): React.JSX.Element {
  const boardSize = useBoardSize();
  const parsed = parsePositionFen(puzzle.startingFen);
  const position = parsed.ok ? parsed.position : null;
  const bucket = difficultyBucketOf(puzzle.difficulty);
  const moveNumber = Math.floor(puzzle.sourcePly / 2) + 1;
  const sideToMove = puzzle.sideToMove === 'white' ? 'White' : 'Black';

  return (
    <section className={styles.card} aria-label="Puzzle from your games" data-testid="home-preview">
      <div className={styles.header}>
        <h2 className={styles.heading}>From your games</h2>
        <span className={styles.pill}>Puzzle</span>
      </div>
      <div className={styles.body}>
        <div className={styles.boardArea} data-testid="home-preview-board">
          {position !== null ? (
            <Chessboard
              position={position}
              interactive={false}
              orientation={puzzle.sideToMove}
              drawable
              boardSize={boardSize}
            />
          ) : (
            <p className={styles.missing}>Starting position unavailable.</p>
          )}
        </div>
        <div className={styles.info}>
          <p className={styles.objective} data-testid="home-preview-objective">
            {puzzleObjectiveLabel(puzzle)}
          </p>
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>Difficulty</dt>
              <dd data-testid="home-preview-difficulty">
                {bucket.name} · {puzzle.difficulty}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>Side to move</dt>
              <dd>{sideToMove}</dd>
            </div>
            <div className={styles.fact}>
              <dt>From</dt>
              <dd data-testid="home-preview-provenance">Move {moveNumber}</dd>
            </div>
          </dl>
          <Link className={styles.link} to={ROUTES.training} data-testid="home-preview-link">
            Train puzzles
          </Link>
        </div>
      </div>
    </section>
  );
}
