import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { makeSan } from 'chessops/san';
import { isNormal } from 'chessops/types';
import { parseUci } from 'chessops/util';
import { Chessboard, type ChessboardHandle } from '@/components/chessboard/Chessboard';
import { DEFAULT_PIECE_SET } from '@/components/chessboard/themes';
import { PromotionDialog, type PromotionRole } from '@/components/chessboard/PromotionDialog';
import { Navigation } from '@/components/chessboard/Navigation';
import { uciMoveArrow } from '@/components/chessboard/boardShapes';
import { useBoardSize, type UseBoardSize } from '@/components/chessboard/useBoardSize';
import { Button } from '@/components/ui/Button';
import { parsePositionFen } from '@/domain/chess';
import type { Position } from '@/domain/chess';
import { puzzleObjectiveLabel } from '@/domain/puzzle';
import type { PuzzleRow } from '@/domain/puzzle';
import {
  hintContent,
  nextHintLevel,
  type HintLevel,
  type PresentationOutcome,
  type SessionPuzzleContext,
  type SolveHintConfig,
} from '@/domain/training';
import type { PuzzleAttemptRecorderLike } from '@/infrastructure/training';
import { usePuzzleSolve, type MoveSubmission, type WritePhase } from '@/hooks/usePuzzleSolve';
import { KeyboardMoveEntry } from './KeyboardMoveEntry';
import { OutcomePanel } from './OutcomePanel';
import { PostSolvePanel, type StoredAnalysisLookup } from './PostSolvePanel';
import { formatSolveTime } from './solveText';
import styles from './SolveScreen.module.css';

const PROMOTION_ROLE_LETTER: Readonly<Record<PromotionRole, 'q' | 'r' | 'b' | 'n'>> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};

const HINT_HIGHLIGHT_BRUSH = 'yellow';
const WRONG_MOVE_BRUSH = 'red';

/** Host contract of the solving screen (Feature 013 supplies these props). */
export interface SolveScreenProps {
  /** The immutable puzzle row being presented. */
  readonly row: PuzzleRow;
  /** Host-supplied set/cycle/presentation coordinates. */
  readonly context: SessionPuzzleContext;
  /** Per-set hint availability/threshold configuration. */
  readonly config: SolveHintConfig;
  /** Outcome-write seam (stubbed in tests; no IndexedDB). */
  readonly recorder: PuzzleAttemptRecorderLike;
  /** Return to the host with the recorded outcome, or `null` on discard. */
  readonly onExit: (outcome: PresentationOutcome | null) => void;
  /** Optional shared board-size API (defaults to the standard sizing hook). */
  readonly boardSize?: UseBoardSize;
  /** Optional stored-analysis seam for the post-solve step (ADR-033). */
  readonly storedAnalysis?: StoredAnalysisLookup;
}

/**
 * The Feature-012-owned solving screen (spec "User-facing behavior"): presents
 * an immutable `PuzzleRow` on the shared Chessboard (orientation = side to
 * move), with mouse/touch + pointer-free move entry, per-level hints, move-line
 * transport over the current presentation only, restart/hint/skip/give-up,
 * outcome summaries, and the engine-free stored-only post-solve step. No
 * difficulty is ever shown while solving, and every action is a labelled
 * control reachable by keyboard and touch (keyboard is never the only path).
 */
export function SolveScreen({
  row,
  context,
  config,
  recorder,
  onExit,
  boardSize,
  storedAnalysis,
}: SolveScreenProps): React.JSX.Element {
  const controller = usePuzzleSolve({ row, context, config, recorder });
  const ownBoardSize = useBoardSize();
  const resolvedBoardSize = boardSize ?? ownBoardSize;
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(
    null,
  );
  const boardRef = useRef<ChessboardHandle | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const stage = controller.stage;

  const startPosition = useMemo<Position | null>(() => {
    const parsed = parsePositionFen(row.startingFen);
    return parsed.ok ? parsed.position : null;
  }, [row.startingFen]);

  // Focus the objective on presentation start (a11y; stage transitions later).
  useEffect(() => {
    if (stage === 'solving') {
      headingRef.current?.focus();
    }
  }, [row.sourceGameId, row.sourcePly, stage]);

  const sanAt = useCallback((position: Position | null, uci: string): string => {
    if (position === null) {
      return uci;
    }
    const move = parseUci(uci);
    if (move === undefined || !isNormal(move) || !position.isLegal(move)) {
      return uci;
    }
    return makeSan(position, move);
  }, []);

  const handleVerdict = useCallback(
    (verdict: MoveSubmission, uci: string | null): void => {
      if (verdict.kind === 'wrong') {
        const text = uci === null ? '' : sanAt(controller.decisionPosition, uci);
        setAnnouncement(
          `${text === '' ? 'That move' : `${text}`} is not the move that achieves the objective. Try again.`,
        );
      } else if (verdict.kind === 'illegal') {
        setAnnouncement('That is not a legal move here.');
      } else if (verdict.kind === 'solved') {
        setAnnouncement('Solved!');
      } else {
        setAnnouncement(null);
      }
    },
    [controller.decisionPosition, sanAt],
  );

  const handleBoardMove = useCallback(
    (from: Key, to: Key): void => {
      const uci = `${from}${to}`;
      handleVerdict(controller.submitTextMove(uci), uci);
    },
    [controller, handleVerdict],
  );

  const handleTextMove = useCallback(
    (uci: string): void => {
      handleVerdict(controller.submitTextMove(uci), uci);
    },
    [controller, handleVerdict],
  );

  const handlePromotionSelect = useCallback(
    (role: PromotionRole): void => {
      if (pendingPromotion === null) {
        return;
      }
      const { from, to } = pendingPromotion;
      const uci = `${from}${to}${PROMOTION_ROLE_LETTER[role]}`;
      setPendingPromotion(null);
      boardRef.current?.clearPendingPromotion();
      handleVerdict(controller.submitTextMove(uci), uci);
    },
    [pendingPromotion, controller, handleVerdict],
  );

  const handlePromotionCancel = useCallback((): void => {
    setPendingPromotion(null);
    boardRef.current?.clearPendingPromotion();
    boardRef.current?.selectSquare(null);
  }, []);

  const handleRestart = useCallback((): void => {
    controller.restart();
    setAnnouncement('Restarted. Try the puzzle again from the start.');
  }, [controller]);

  const handleHint = useCallback((): void => {
    if (!controller.canHint || startPosition === null) {
      return;
    }
    const revealed = controller.revealedHintLevels;
    const reached: HintLevel | null = revealed.length > 0 ? revealed[revealed.length - 1]! : null;
    const nextLevel = nextHintLevel(reached, config);
    if (nextLevel !== null) {
      const content = hintContent(nextLevel, row, startPosition);
      if (content.ok) {
        setAnnouncement(content.content.text);
      }
    }
    controller.revealHint();
  }, [controller, config, row, startPosition]);

  const handleSkip = useCallback((): void => {
    controller.skip();
  }, [controller]);

  const handleGiveUp = useCallback((): void => {
    controller.giveUp();
  }, [controller]);

  // Latest revealed hint content (shown as text under the controls).
  const revealedTexts = useMemo(() => {
    const levels = controller.revealedHintLevels;
    if (startPosition === null || levels.length === 0) {
      return [];
    }
    const texts: string[] = [];
    for (const level of levels) {
      const content = hintContent(level, row, startPosition);
      texts.push(content.ok ? content.content.text : '');
    }
    return texts.filter((text) => text.length > 0);
  }, [controller.revealedHintLevels, row, startPosition]);

  const hintShapes = useMemo<readonly DrawShape[]>(() => {
    if (startPosition === null) {
      return [];
    }
    const shapes: DrawShape[] = [];
    const seen = new Set<string>();
    for (const level of controller.revealedHintLevels) {
      const content = hintContent(level, row, startPosition);
      if (!content.ok) {
        continue;
      }
      for (const square of content.content.squares) {
        if (!seen.has(square)) {
          seen.add(square);
          shapes.push({ orig: square as Key, brush: HINT_HIGHLIGHT_BRUSH });
        }
      }
    }
    return shapes;
  }, [controller.revealedHintLevels, row, startPosition]);

  const wrongArrow = useMemo<DrawShape | null>(() => {
    const uci = controller.lastWrongUci;
    return uci === null ? null : uciMoveArrow(uci, WRONG_MOVE_BRUSH);
  }, [controller.lastWrongUci]);

  const autoShapes = useMemo<readonly DrawShape[]>(() => {
    if (stage === 'solving' && controller.atDecisionPoint && controller.lastWrongUci !== null) {
      return wrongArrow === null ? [...hintShapes] : [wrongArrow, ...hintShapes];
    }
    return hintShapes;
  }, [stage, controller.atDecisionPoint, controller.lastWrongUci, wrongArrow, hintShapes]);

  const lastMoveKeys = useMemo<readonly [Key, Key] | null>(() => {
    if (controller.viewPly === 0) {
      return null;
    }
    const token = controller.playedLine[controller.viewPly - 1];
    if (token === undefined || token.length < 4) {
      return null;
    }
    return [token.slice(0, 2) as Key, token.slice(2, 4) as Key];
  }, [controller.viewPly, controller.playedLine]);

  if (stage === 'error') {
    return (
      <section className={styles.screen} data-testid="solve-screen">
        <h1 className={styles.heading} ref={headingRef} tabIndex={-1}>
          Puzzle could not be loaded
        </h1>
        <p className={styles.errorText} role="alert" data-testid="solve-load-error">
          {controller.loadError}
        </p>
        <div className={styles.controls}>
          <Button variant="primary" onClick={() => onExit(null)} data-testid="solve-exit-error">
            Back to the cycle
          </Button>
        </div>
      </section>
    );
  }

  if (stage === 'outcome' && controller.outcome !== null) {
    return (
      <section className={styles.screen} data-testid="solve-screen">
        <OutcomePanel
          result={controller.outcome.result}
          solvingTimeMs={controller.outcome.solvingTimeMs}
          wrongMoveCount={controller.outcome.wrongMoveCount}
          hintCount={controller.outcome.hintCount}
          highestHintLevel={controller.outcome.highestHintLevel}
          writePhase={(controller.writePhase ?? 'pending') as WritePhase}
          writeError={controller.writeError}
          canAnalyze={controller.outcome.solved}
          onRetryWrite={controller.retryWrite}
          onDiscard={() => onExit(null)}
          onAnalyze={controller.openPostSolve}
          onContinue={() => onExit(controller.exitOutcome())}
        />
      </section>
    );
  }

  if (stage === 'postSolve' && controller.outcome !== null) {
    return (
      <section className={styles.screen} data-testid="solve-screen">
        <PostSolvePanel
          row={row}
          outcome={controller.outcome}
          attemptLine={controller.playedLine}
          wrongMovesTried={controller.wrongMovesTried}
          {...(storedAnalysis !== undefined ? { storedAnalysis } : {})}
          boardSize={resolvedBoardSize}
          onContinue={() => onExit(controller.exitOutcome())}
        />
      </section>
    );
  }

  const interactive = stage === 'solving' && controller.atDecisionPoint;
  const objective = puzzleObjectiveLabel(row);
  const toMove = row.sideToMove === 'white' ? 'White' : 'Black';

  return (
    <section className={styles.screen} data-testid="solve-screen">
      <header className={styles.header}>
        <div>
          <h2
            className={styles.heading}
            ref={headingRef}
            tabIndex={-1}
            data-testid="solve-objective"
          >
            {objective}
          </h2>
          <p className={styles.subtitle} data-testid="solve-side-to-move">
            {toMove} to move — find the move that achieves the objective.
          </p>
        </div>
        <p className={styles.clock} data-testid="solve-clock">
          {formatSolveTime(controller.elapsedMs)}
        </p>
      </header>

      <div className={styles.boardAndSide}>
        <div className={styles.boardWrap}>
          <div className={styles.boardArea}>
            {controller.position !== null ? (
              <Chessboard
                ref={boardRef}
                position={controller.position}
                interactive={interactive}
                drawable={!interactive}
                orientation={row.sideToMove}
                lastMove={lastMoveKeys}
                autoShapes={interactive ? autoShapes : hintShapes}
                boardSize={resolvedBoardSize}
                onMove={handleBoardMove}
                onPromotionRequired={(pending) => {
                  setPendingPromotion({ from: pending.from, to: pending.to });
                }}
              />
            ) : (
              <p className={styles.errorText} role="alert">
                {controller.loadError}
              </p>
            )}
            <PromotionDialog
              open={pendingPromotion !== null}
              pieceSet={DEFAULT_PIECE_SET}
              onSelect={handlePromotionSelect}
              onCancel={handlePromotionCancel}
            />
          </div>

          <div className={styles.transportRow}>
            <h3 className={styles.srOnly}>Current presentation&apos;s moves</h3>
            <Navigation
              currentPly={controller.viewPly}
              totalPlies={controller.lineLength}
              onNavigate={(target) => controller.goToPly(target === 'last' ? 'end' : target)}
            />
          </div>
        </div>

        <aside className={styles.side} aria-label="Solve controls">
          <div className={styles.counters}>
            <p data-testid="solve-wrong-count">
              Wrong moves: <strong>{controller.wrongMoveCount}</strong>
            </p>
            <p data-testid="solve-hint-count">
              Hints used: <strong>{controller.hintCount}</strong>
            </p>
          </div>

          {revealedTexts.length > 0 ? (
            <ul className={styles.hintList} data-testid="solve-hint-list">
              {revealedTexts.map((text, index) => (
                <li key={`${text}-${index}`} data-testid={`solve-hint-item-${index}`}>
                  {text}
                </li>
              ))}
            </ul>
          ) : null}

          <KeyboardMoveEntry
            position={controller.atDecisionPoint ? controller.decisionPosition : null}
            onSubmitLegalMove={handleTextMove}
          />

          <div className={styles.controls}>
            <Button variant="secondary" onClick={handleRestart} data-testid="solve-restart">
              Restart
            </Button>
            <Button
              variant="secondary"
              onClick={handleHint}
              disabled={!controller.canHint}
              data-testid="solve-hint"
            >
              Hint
            </Button>
            <Button variant="secondary" onClick={handleSkip} data-testid="solve-skip">
              Skip
            </Button>
            <Button variant="secondary" onClick={handleGiveUp} data-testid="solve-give-up">
              Give up
            </Button>
          </div>
        </aside>
      </div>

      <p className={styles.srOnly} role="status" data-testid="solve-announcement">
        {announcement ?? ''}
      </p>
    </section>
  );
}
