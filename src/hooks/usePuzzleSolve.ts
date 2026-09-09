import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Position } from '@/domain/chess';
import type { PuzzleRow } from '@/domain/puzzle';
import {
  applyMove,
  beginPresentation,
  buildAttemptRow,
  nextHintLevel,
  positionAtPly,
  presentationOutcomeOf,
  revealNextHint,
  restartPresentation,
  type BuildAttemptRowInput,
  type HintLevel,
  type PresentationCounters,
  type PresentationOutcome,
  type PresentationState,
  type SessionPuzzleContext,
  type SolveHintConfig,
} from '@/domain/training';
import type { PuzzleAttemptRecorderLike } from '@/infrastructure/training';

/** Wall-clock tick for the live solving timer (millis). */
export const SOLVE_TIMER_TICK_MS = 250;

/** Auto-open the post-solve step when a `failed` outcome lands (OQ-4 default). */
export const AUTO_OPEN_POSTSOLVE_ON_FAILED = true;

/** Presentation-screen states (spec "States"; never persisted). */
export type SolveStage = 'presenting' | 'solving' | 'outcome' | 'postSolve';

/** Verdict of a submitted move, for immediate UI feedback (arrow/announcement). */
export type MoveSubmission =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'solved' }
  | { readonly kind: 'wrong' }
  | { readonly kind: 'illegal' }
  | { readonly kind: 'ignored' };

/** Attempt-write phases at a definite outcome (spec States). */
export type WritePhase = 'pending' | 'written' | 'retryable';

/** Options for `usePuzzleSolve` (one presentation per mount). */
export interface UsePuzzleSolveOptions {
  /** The immutable Feature-011 row being presented. */
  readonly row: PuzzleRow;
  /** Host-supplied set/cycle/presentation coordinates. */
  readonly context: SessionPuzzleContext;
  /** Per-set hint availability/threshold configuration. */
  readonly config: SolveHintConfig;
  /** Outcome-write seam (stubbed in tests; no IndexedDB). */
  readonly recorder: PuzzleAttemptRecorderLike;
  /** Wall clock (Unix epoch millis), injectable for deterministic tests. */
  readonly now?: () => number;
}

/** The presentation controller SolveScreen and Feature 013's host consume. */
export interface PuzzleSolveController {
  readonly stage: SolveStage | 'error';
  /** Non-null when the row failed to load (unparseable FEN; spec Error cases). */
  readonly loadError: string | null;
  /** Position at the viewed ply (`null` when the presentation failed to load). */
  readonly position: Position | null;
  /** Decision-point position when move entry is allowed, else `null`. */
  readonly decisionPosition: Position | null;
  readonly orientation: PuzzleRow['sideToMove'];
  readonly viewPly: number;
  readonly lineLength: number;
  /** The played line (UCI tokens), source of the post-solve move list. */
  readonly playedLine: readonly string[];
  /** True when a move may be submitted (solving at the end of the line). */
  readonly atDecisionPoint: boolean;
  readonly wrongMovesTried: readonly string[];
  readonly wrongMoveCount: number;
  readonly hintCount: number;
  readonly highestHintLevel: HintLevel | null;
  readonly revealedHintLevels: readonly HintLevel[];
  /** Wall-clock solving time since `startedAt` (restart keeps the clock). */
  readonly elapsedMs: number;
  /** Last wrong move (UCI) for a red-arrow marker; cleared on restart/accept. */
  readonly lastWrongUci: string | null;
  /** True when the next hint press would reveal content. */
  readonly canHint: boolean;
  /**
   * Board-path move entry. `from`/`to` are board squares; `promotion` is the
   * canonical promotion role letter when the move promotes.
   */
  playBoardMove(from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n'): MoveSubmission;
  /** Advance one hint level per press. */
  revealHint(): void;
  /** Presentation-scoped restart: clears line + hint content, keeps counters/clock. */
  restart(): void;
  /** End the presentation with result `skipped`. */
  skip(): void;
  /** End the presentation with result `failed` (give up / show solution). */
  giveUp(): void;
  /** Navigate the presentation's move line (view only; R-10). */
  goToPly(target: 'first' | 'prev' | 'next' | 'end'): void;
  /** Open the engine-free, stored-only post-solve step. */
  openPostSolve(): void;
  /** Retry a failed attempt write (idempotent; the outcome stays visible). */
  retryWrite(): void;
  /** Write-phase of the current outcome (`null` until a definite outcome). */
  readonly writePhase: WritePhase | null;
  /** Inline write-error text while `writePhase === 'retryable'`. */
  readonly writeError: string | null;
  /** The outcome summary; present from the moment a definite outcome lands. */
  readonly outcome: PresentationOutcome | null;
  /**
   * The outcome the host may advance with: the recorded outcome once the row is
   * written, or `null` while the row is unwritten (pending/retryable write, or
   * an explicit discard-on-exit). Never auto-advances past an unwritten row.
   */
  exitOutcome(): PresentationOutcome | null;
}

/** Pure domain-state reducer: every transition runs a Stage-A pure function. */
type DomainAction =
  | { readonly type: 'set'; readonly state: PresentationState | null }
  | { readonly type: 'move'; readonly uci: string }
  | { readonly type: 'restart' };

function domainReducer(
  state: PresentationState | null,
  action: DomainAction,
): PresentationState | null {
  if (action.type === 'set') {
    return action.state;
  }
  if (state === null) {
    return null;
  }
  if (action.type === 'move') {
    return applyMove(state, action.uci).state;
  }
  return restartPresentation(state);
}

function countersOf(state: PresentationState): PresentationCounters {
  return {
    wrongMoveCount: state.wrongMoveCount,
    hintCount: state.hintCount,
    highestHintLevel: state.highestHintLevel,
  };
}

function positionAt(state: PresentationState, ply: number): Position | null {
  const at = positionAtPly(state, ply);
  return at.ok ? at.position : null;
}

/**
 * Presentation controller over the Stage-A solver (spec "States").
 *
 * Owns one presentation's lifecycle (`presenting → solving → outcome →
 * postSolve`), the wall-clock timer, hints, wrong-move feedback, move-line
 * transport, and the definite-outcome write through the injected recorder.
 * Domain state is `useReducer` state transitioned only by Stage-A pure
 * functions. A row that fails to load surfaces as a typed load error (the
 * session never crashes); a failed write keeps the outcome screen visible with
 * an inline error + retry, and `exitOutcome()` never reports an unwritten row.
 */
export function usePuzzleSolve(options: UsePuzzleSolveOptions): PuzzleSolveController {
  const { row, context, config, recorder, now = () => Date.now() } = options;

  const [initial] = useState<{ state: PresentationState | null; error: string | null }>(() => {
    const began = beginPresentation(row, now());
    return began.ok ? { state: began.state, error: null } : { state: null, error: began.message };
  });
  const [stage, setStage] = useState<SolveStage>(initial.error === null ? 'solving' : 'outcome');
  const [presentation, dispatch] = useReducer(domainReducer, initial.state);
  const [viewPly, setViewPly] = useState(0);
  const [lastWrongUci, setLastWrongUci] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [writePhase, setWritePhase] = useState<WritePhase | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PresentationOutcome | null>(null);

  const cancelledRef = useRef(false);
  const endedAtRef = useRef<number | null>(null);
  const recordInputRef = useRef<BuildAttemptRowInput | null>(null);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  async function doRecord(input: BuildAttemptRowInput): Promise<void> {
    if (cancelledRef.current) {
      return;
    }
    setWritePhase('pending');
    setWriteError(null);
    try {
      await recorder.record(input);
      if (cancelledRef.current) {
        return;
      }
      setWritePhase('written');
      // A `failed` outcome opens the post-solve step automatically once its row
      // is written (OQ-4 default; skipped puzzles never offer the step).
      if (AUTO_OPEN_POSTSOLVE_ON_FAILED && input.trigger === 'gaveUp') {
        setStage('postSolve');
      }
    } catch (error) {
      if (cancelledRef.current) {
        return;
      }
      setWriteError(error instanceof Error ? error.message : 'Failed to record this attempt.');
      setWritePhase('retryable');
    }
  }

  function finalize(trigger: 'solved' | 'gaveUp' | 'skip'): void {
    if (presentation === null || writePhase !== null || endedAtRef.current !== null) {
      return;
    }
    const endedAt = now();
    endedAtRef.current = endedAt;
    const input: BuildAttemptRowInput = {
      row,
      context,
      trigger,
      counters: countersOf(presentation),
      startedAt: presentation.startedAt,
      endedAt,
    };
    recordInputRef.current = input;
    setOutcome(presentationOutcomeOf(buildAttemptRow(input)));
    setElapsedMs(Math.max(0, endedAt - presentation.startedAt));
    setViewPly(presentation.line.length);
    setWritePhase('pending');
    setWriteError(null);
    setStage('outcome');
    void doRecord(input);
  }

  function submitMove(uci: string): MoveSubmission {
    if (presentation === null || stage !== 'solving' || viewPly !== presentation.line.length) {
      return { kind: 'ignored' };
    }
    const result = applyMove(presentation, uci);
    dispatch({ type: 'move', uci });
    if (result.kind === 'illegal') {
      setLastWrongUci(null);
      return { kind: 'illegal' };
    }
    if (result.kind === 'wrong') {
      setLastWrongUci(uci);
      return { kind: 'wrong' };
    }
    setLastWrongUci(null);
    setViewPly(result.state.line.length);
    if (result.solved) {
      finalize('solved');
      return { kind: 'solved' };
    }
    return { kind: 'accepted' };
  }

  const playBoardMove = (
    from: string,
    to: string,
    promotion?: 'q' | 'r' | 'b' | 'n',
  ): MoveSubmission => submitMove(`${from}${to}${promotion ?? ''}`);

  function revealHint(): void {
    if (presentation === null) {
      return;
    }
    const result = revealNextHint(presentation, config);
    if (!result.ok) {
      return;
    }
    dispatch({ type: 'set', state: result.state });
    setLastWrongUci(null);
  }

  function restart(): void {
    dispatch({ type: 'restart' });
    setViewPly(0);
    setLastWrongUci(null);
  }

  function goToPly(target: 'first' | 'prev' | 'next' | 'end'): void {
    setViewPly((current) => {
      const total = presentation?.line.length ?? 0;
      if (target === 'first') {
        return 0;
      }
      if (target === 'end') {
        return total;
      }
      if (target === 'prev') {
        return Math.max(0, current - 1);
      }
      return Math.min(total, current + 1);
    });
  }

  function skip(): void {
    finalize('skip');
  }

  function giveUp(): void {
    finalize('gaveUp');
  }

  function openPostSolve(): void {
    if (writePhase !== 'written' || outcome === null) {
      return;
    }
    setStage('postSolve');
  }

  function retryWrite(): void {
    const input = recordInputRef.current;
    if (input !== null) {
      void doRecord(input);
    }
  }

  function exitOutcome(): PresentationOutcome | null {
    if (writePhase === 'written') {
      return outcome;
    }
    return null;
  }

  // Live wall-clock timer (presenting/solving only; restart keeps the clock).
  const startedAt = presentation?.startedAt;
  useEffect(() => {
    if (stage !== 'solving' || startedAt === undefined) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setElapsedMs(Math.max(0, now() - startedAt));
    }, SOLVE_TIMER_TICK_MS);
    return () => window.clearInterval(timer);
  }, [stage, startedAt, now]);

  const position = useMemo(
    () => (presentation === null ? null : positionAt(presentation, viewPly)),
    [presentation, viewPly],
  );

  const decisionPosition = useMemo(
    () =>
      presentation === null || stage !== 'solving'
        ? null
        : positionAt(presentation, presentation.line.length),
    [presentation, stage],
  );

  const canHint = useMemo(() => {
    if (presentation === null || stage !== 'solving' || presentation.line.length > 0) {
      return false;
    }
    const revealed = presentation.revealedHintLevels;
    const reached: HintLevel | null = revealed.length > 0 ? revealed[revealed.length - 1]! : null;
    return nextHintLevel(reached, config) !== null;
  }, [presentation, stage, config]);

  return {
    stage: initial.error !== null ? 'error' : stage,
    loadError: initial.error,
    position,
    decisionPosition,
    orientation: row.sideToMove,
    viewPly,
    lineLength: presentation?.line.length ?? 0,
    playedLine: presentation?.line ?? [],
    atDecisionPoint: stage === 'solving' && viewPly === (presentation?.line.length ?? 0),
    wrongMovesTried: presentation?.wrongMovesTried ?? [],
    wrongMoveCount: presentation?.wrongMoveCount ?? 0,
    hintCount: presentation?.hintCount ?? 0,
    highestHintLevel: presentation?.highestHintLevel ?? null,
    revealedHintLevels: presentation?.revealedHintLevels ?? [],
    elapsedMs,
    lastWrongUci,
    canHint,
    playBoardMove,
    revealHint,
    restart,
    skip,
    giveUp,
    goToPly,
    openPostSolve,
    retryWrite,
    writePhase,
    writeError,
    outcome,
    exitOutcome,
  };
}
