import { useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import type { Key } from '@lichess-org/chessground/types';
import { isNormal } from 'chessops/types';
import { parseUci } from 'chessops/util';
import { AnalysisBoard } from '@/components/analysis/board/AnalysisBoard';
import { Chessboard } from '@/components/chessboard/Chessboard';
import { MoveListPane } from '@/components/chessboard/MoveListPane';
import { Navigation } from '@/components/chessboard/Navigation';
import type { UseBoardSize } from '@/components/chessboard/useBoardSize';
import { nagMeta } from '@/components/chessboard/pgnAnnotations';
import { Button } from '@/components/ui/Button';
import { analysesRepository } from '@/infrastructure/db/analysis-repository';
import type { MoveAnalysis, Position } from '@/domain/chess';
import { cpValueOf, parsePositionFen, uciPvToSan, winPercentFromCp } from '@/domain/chess';
import { CLASSIFICATION_LABEL_TEXT, nagForClassification } from '@/domain/analysis';
import type { PuzzleRow } from '@/domain/puzzle';
import type { PresentationOutcome } from '@/domain/training';
import { displayMoveText, resultLabel } from './solveText';
import styles from './PostSolvePanel.module.css';

/**
 * Stored, game-scoped analysis lookup the post-solve step reads (ADR-033: the
 * one game-scoped `MoveAnalysis` lookup at the source ply; stored data only).
 */
export interface StoredAnalysisLookup {
  readonly listForGameAndAnalysis: (
    gameId: string,
    analysisId: string,
  ) => Promise<readonly MoveAnalysis[]>;
}

export interface PostSolvePanelProps {
  /** The puzzle row being reviewed (source of the stored data). */
  readonly row: PuzzleRow;
  /** The recorded outcome of the presentation. */
  readonly outcome: PresentationOutcome;
  /** The presentation's played line, UCI tokens from `startingFen`. */
  readonly attemptLine: readonly string[];
  /** Wrong moves tried during the presentation (never in the played line). */
  readonly wrongMovesTried: readonly string[];
  /** Stored-analysis seam; defaults to the IndexedDB repository. */
  readonly storedAnalysis?: StoredAnalysisLookup;
  readonly boardSize: UseBoardSize;
  /** Close the step and return to the host (the outcome is preserved). */
  readonly onContinue: () => void;
}

/**
 * Engine-free, stored-data-only post-solve step (spec "Post-solve analysis",
 * ADR-033): a read-only use of the shared analysis-board surface replaying the
 * presentation's played line, with the user's attempt alongside the stored
 * verified solution and rejected wrong moves. A stored ADR-023 glyph / eval
 * swing renders only where a stored `MoveAnalysis` record for the divergence
 * move exists — absent data is never fabricated, and solved moves are marked
 * "matches the verified solution", never with an ADR-023 `best` label.
 */
export function PostSolvePanel({
  row,
  outcome,
  attemptLine,
  wrongMovesTried,
  storedAnalysis = analysesRepository,
  boardSize,
  onContinue,
}: PostSolvePanelProps): React.JSX.Element {
  const [ply, setPly] = useState(attemptLine.length);
  const [records, setRecords] = useState<readonly MoveAnalysis[] | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    storedAnalysis
      .listForGameAndAnalysis(row.sourceGameId, row.analysisId)
      .then((list) => {
        if (active) {
          setRecords(list);
        }
      })
      .catch(() => {
        if (active) {
          setRecords([]);
        }
      });
    return () => {
      active = false;
    };
  }, [storedAnalysis, row.sourceGameId, row.analysisId]);

  const attemptSans = useMemo(
    () => sansOfLine(row.startingFen, attemptLine),
    [row.startingFen, attemptLine],
  );

  const position = useMemo(
    () => positionAfterTokens(row.startingFen, attemptLine, ply),
    [row.startingFen, attemptLine, ply],
  );

  const lastMoveKeys = useMemo<readonly [Key, Key] | null>(() => {
    if (ply === 0) {
      return null;
    }
    const token = attemptLine[ply - 1];
    if (token === undefined || token.length < 4) {
      return null;
    }
    return [token.slice(0, 2) as Key, token.slice(2, 4) as Key];
  }, [attemptLine, ply]);

  // Stored source-ply record: the game's actually-played move at the puzzle's
  // source ply (a divergence annotation renders only when this record exists).
  const sourceRecord = useMemo(() => {
    const list = records ?? [];
    return (
      list.find(
        (record) => record.ply === row.sourcePly && record.playedMove.uci === row.userMovePlayed,
      ) ?? null
    );
  }, [records, row.sourcePly, row.userMovePlayed]);

  return (
    <div className={styles.panel} ref={panelRef} tabIndex={-1} data-testid="post-solve-panel">
      <div className={styles.summary} role="status" data-testid="post-solve-result">
        {resultLabel(outcome.result)} — the attempt is compared with the stored solution below.
      </div>

      <AnalysisBoard
        boardSize={boardSize}
        boardColumn={
          <div className={styles.boardColumn}>
            {position !== null ? (
              <Chessboard
                position={position}
                interactive={false}
                drawable
                orientation={row.sideToMove}
                lastMove={lastMoveKeys}
                boardSize={boardSize}
              />
            ) : (
              <p className={styles.positionMissing} data-testid="post-solve-position-missing">
                The played line cannot be replayed.
              </p>
            )}
            <Navigation
              currentPly={ply}
              totalPlies={attemptLine.length}
              onNavigate={(target) => {
                setPly((current) => {
                  if (target === 'first') {
                    return 0;
                  }
                  if (target === 'last') {
                    return attemptLine.length;
                  }
                  if (target === 'prev') {
                    return Math.max(0, current - 1);
                  }
                  return Math.min(attemptLine.length, current + 1);
                });
              }}
            />
          </div>
        }
        bar={null}
        sidePanel={
          <MoveListPane dataTestId="post-solve-moves">
            <MoveListBody
              row={row}
              attemptLine={attemptLine}
              attemptSans={attemptSans}
              wrongMovesTried={wrongMovesTried}
              solved={outcome.solved}
              sourceRecord={sourceRecord}
            />
          </MoveListPane>
        }
      />

      <div className={styles.actions}>
        <Button variant="primary" onClick={onContinue} data-testid="post-solve-continue">
          Continue
        </Button>
      </div>
    </div>
  );
}

function MoveListBody({
  row,
  attemptLine,
  attemptSans,
  wrongMovesTried,
  solved,
  sourceRecord,
}: {
  readonly row: PuzzleRow;
  readonly attemptLine: readonly string[];
  readonly attemptSans: readonly string[];
  readonly wrongMovesTried: readonly string[];
  readonly solved: boolean;
  readonly sourceRecord: MoveAnalysis | null;
}): React.JSX.Element {
  const alternatives = useMemo(() => {
    const distinct = [...new Set(row.acceptedFirstMoves ?? [])];
    return distinct.filter((uci) => uci !== row.bestMove);
  }, [row]);

  return (
    <>
      {attemptLine.length > 0 ? (
        <section className={styles.section} data-testid="post-attempt-section">
          <h3 className={styles.sectionTitle}>Your moves</h3>
          <ol className={styles.moveRows} data-testid="post-attempt-list">
            {attemptSans.map((san, index) => (
              <li
                className={styles.moveRow}
                key={`${attemptLine[index] ?? index}`}
                data-testid={`post-attempt-move-${index}`}
              >
                <span className={styles.san}>{san}</span>
                {solved ? (
                  <span className={styles.matching} data-testid={`post-attempt-match-${index}`}>
                    matches the verified solution
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {wrongMovesTried.length > 0 ? (
        <section className={styles.section} data-testid="post-wrong-section">
          <h3 className={styles.sectionTitle}>Wrong moves</h3>
          <ul className={styles.moveRows}>
            {wrongMovesTried.map((uci, index) => {
              const annotated =
                sourceRecord !== null && uci === row.userMovePlayed && solved === false;
              return (
                <li
                  className={styles.moveRow}
                  key={`${uci}-${index}`}
                  data-testid={`post-wrong-move-${index}`}
                >
                  <span className={styles.wrongText}>
                    Your move <strong>{displayMoveText(row.startingFen, [uci])}</strong> — not the
                    move that achieves the objective.
                  </span>
                  {annotated ? <StoredAnnotation record={sourceRecord} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} data-testid="post-solution-section">
        <h3 className={styles.sectionTitle}>Verified solution</h3>
        <p className={styles.solutionText} data-testid="post-solution-text">
          {displayMoveText(row.startingFen, [...row.bestPv])}
        </p>
        {alternatives.length > 0 ? (
          <p className={styles.alternatives} data-testid="post-solution-alternatives">
            Also accepted:{' '}
            {alternatives.map((uci) => (
              <span key={uci} className={styles.acceptedChip}>
                {displayMoveText(row.startingFen, [uci])}
              </span>
            ))}
          </p>
        ) : null}
      </section>
    </>
  );
}

/**
 * The stored-only divergence annotation (ADR-023): rendered verbatim from the
 * stored `MoveAnalysis` record's classification, stored evaluation pair and
 * engine preference — never computed in the view; absent data renders nothing.
 */
function StoredAnnotation({ record }: { readonly record: MoveAnalysis }): React.JSX.Element {
  const nag = nagForClassification(record.classification);
  const glyph = nag === null ? null : (nagMeta(nag)?.glyph ?? null);
  const before = winPercentFromCp(cpValueOf(record.evalBefore));
  const after = winPercentFromCp(cpValueOf(record.evalAfter));
  const loss = Math.max(0, Math.round(before - after));
  const preferred = record.bestMove === null ? null : record.bestMove.san;

  return (
    <p className={styles.storedAnnotation} data-testid="post-divergence-annotation">
      {CLASSIFICATION_LABEL_TEXT[record.classification]}
      {glyph !== null ? ` (${glyph})` : ''}: your move lost {loss}% win
      {preferred !== null ? `; the engine preferred ${preferred}` : ''}.
    </p>
  );
}

/** SAN per token of a UCI line replayable from a FEN (empty list otherwise). */
function sansOfLine(fen: string, tokens: readonly string[]): readonly string[] {
  if (tokens.length === 0) {
    return [];
  }
  const converted = uciPvToSan(fen, [...tokens]);
  return converted.ok ? converted.sans : [];
}

/** Position after the first `ply` tokens of a UCI line from a FEN, or null. */
function positionAfterTokens(fen: string, tokens: readonly string[], ply: number): Position | null {
  const parsed = parsePositionFen(fen);
  if (!parsed.ok) {
    return null;
  }
  const position = parsed.position;
  const end = Math.max(0, Math.min(ply, tokens.length));
  for (let index = 0; index < end; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      return null;
    }
    const move = parseUci(token);
    if (move === undefined || !isNormal(move) || !position.isLegal(move)) {
      return null;
    }
    position.play(move);
  }
  return position;
}
