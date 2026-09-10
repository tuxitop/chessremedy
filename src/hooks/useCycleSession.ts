/**
 * Feature 013 — cycle-session host hook (Stage D).
 *
 * The real training-cycle host that drives Feature 012's `SolveScreen` /
 * `usePuzzleSolve` one presentation at a time under the cycle's real ids. It
 * replaces the test-only `HostedSession` harness role: the ordered queue is a
 * **projection of the persisted attempt rows** (no stored cursor), so resume is
 * deterministic and idempotent across reloads and concurrent tabs.
 *
 * Design rules (plan Stage D; spec §5–§7):
 *
 * - **Persisted rows are the source of truth.** The queue is rebuilt with the
 *   Stage-A `reconstructResume` after every durable outcome; the in-memory
 *   queue is never advanced independently. A presentation discarded mid-session
 *   writes no row and therefore leaves its puzzle pending at the same
 *   `presentationIndex`.
 * - **Bounded retry.** A durable `failed` outcome is re-presented per the
 *   cycle's `retryFailed` mode with `presentationIndex + 1`; a re-failed retry
 *   is terminal (at most two presentations per puzzle per cycle). The bound is
 *   enforced by the domain reconstruction, not by a second cursor.
 * - **Completion.** When nothing is pending the hook calls
 *   `cycleService.resume(cycleId)` (which marks the cycle `completed`) and
 *   surfaces `complete`. A genuine attempt-write failure never reaches here
 *   (Feature 012 keeps the outcome visible and `exitOutcome()` returns `null`
 *   while the row is unwritten), so the hook never marks a cycle complete while
 *   a row is unwritten.
 * - **Exit.** `exit()` only ends the session view; the cycle stays `inProgress`
 *   and resumable. The caller performs the navigation back to the set detail;
 *   unmounting discards the presentation (no row).
 *
 * The hook never runs the engine, never touches the network and never writes an
 * attempt row itself (Feature 012's recorder owns the write). It composes the
 * injected real services/repositories and stays deterministic for an injected
 * clock.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PuzzleRow } from '@/domain/puzzle';
import {
  reconstructResume,
  solveHintConfigOf,
  type PresentationOutcome,
  type ResumeQueue,
  type SessionPuzzleContext,
  type SolveHintConfig,
  type TacticalTrainingSetRow,
  type TrainingCycleRow,
} from '@/domain/training';
import type { PuzzleAttemptsRepository } from '@/infrastructure/db/attempts-repository';
import type { CycleService, PuzzleAttemptRecorderLike } from '@/infrastructure/training';

/** The session lifecycle surfaced to the session chrome. */
export type CycleSessionStatus = 'loading' | 'solving' | 'complete' | 'error';

/** One ready-to-present puzzle: the row plus its Feature-012 presentation inputs. */
export interface CycleSessionPuzzle {
  /** The immutable Feature-011 puzzle row being presented. */
  readonly row: PuzzleRow;
  /** Host-supplied set/cycle/presentation coordinates (1-based index). */
  readonly context: SessionPuzzleContext;
  /** The cycle snapshot's hint configuration for this presentation. */
  readonly config: SolveHintConfig;
}

/** Session progress for the "Puzzle X of Y" chrome. */
export interface CycleSessionProgress {
  /**
   * 1-based position of the current puzzle in the cycle snapshot (its retry
   * presentation keeps the same position); `total` once the cycle completes,
   * `0` for an empty snapshot.
   */
  readonly index: number;
  /** The cycle snapshot's puzzle count. */
  readonly total: number;
}

/** Options for `useCycleSession` (one mounted cycle session). */
export interface UseCycleSessionOptions {
  /** The training set the cycle belongs to (supplies the session's set id). */
  readonly set: TacticalTrainingSetRow;
  /** The cycle being trained (its snapshot is authoritative for the session). */
  readonly cycle: TrainingCycleRow;
  /** Hydrated puzzle rows keyed by canonical `puzzleIdOf` id. */
  readonly puzzles: ReadonlyMap<string, PuzzleRow>;
  /** Feature-012 outcome-write seam (the page passes it to `SolveScreen`). */
  readonly recorder: PuzzleAttemptRecorderLike;
  /** Feature-012 attempt persistence (the session's source of truth). */
  readonly attemptsRepository: PuzzleAttemptsRepository;
  /** Feature-013 cycle lifecycle service (completion marking). */
  readonly cycleService: CycleService;
  /**
   * Wall clock (Unix epoch millis), injectable for deterministic tests. The
   * recorder owns attempt-row timestamps; this is the session's resolved clock.
   */
  readonly now?: () => number;
  /** Called once when the queue empties and the cycle is marked `completed`. */
  readonly onComplete?: (cycle: TrainingCycleRow) => void;
}

/** The session controller the cycle-session page consumes. */
export interface CycleSessionController {
  /** The next pending presentation, or `null` while loading/complete/error. */
  readonly current: CycleSessionPuzzle | null;
  /** Progress for the "Puzzle X of Y" chrome (derived from persisted rows). */
  readonly progress: CycleSessionProgress;
  /** Whether the cycle's config snapshot allows skipping. */
  readonly allowSkip: boolean;
  /** Session lifecycle status. */
  readonly status: CycleSessionStatus;
  /** Human-readable session notice (missing puzzles, load failure), else `null`. */
  readonly notice: string | null;
  /** The outcome-write seam, for `SolveScreen`. */
  readonly recorder: PuzzleAttemptRecorderLike;
  /** The session's resolved clock, for `SolveScreen`/the page. */
  readonly now: () => number;
  /**
   * Apply a presentation outcome. `null` is a discard (the puzzle stays pending
   * at the same index); a durable outcome re-reads the persisted rows and
   * rebuilds the queue, completing the cycle when nothing is pending.
   */
  handleOutcome(outcome: PresentationOutcome | null): Promise<void>;
  /**
   * Leave the session view without writing. The cycle stays `inProgress` and
   * resumable; the caller navigates back to the set detail and the mounted
   * `SolveScreen` unmounts, discarding the presentation.
   */
  exit(): void;
}

/** A short human-readable message for an unexpected failure. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The cycle session failed to load.';
}

/**
 * Drive one training-cycle session. See the module header for the contract.
 */
export function useCycleSession(options: UseCycleSessionOptions): CycleSessionController {
  const { set, puzzles, recorder, now = () => Date.now() } = options;
  const cycleId = options.cycle.id;

  // Latest options for the stable async `refresh` without re-creating it on
  // every render (the session inputs are stable for a mounted session). The ref
  // is kept current in an effect so render never writes to it.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const [status, setStatus] = useState<CycleSessionStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [queue, setQueue] = useState<ResumeQueue>([]);
  const [cycle, setCycle] = useState<TrainingCycleRow>(options.cycle);

  // Generation guards stale async loads when the session (cycle id) changes.
  const generationRef = useRef(0);
  // Once exited, late outcomes must not advance the session.
  const exitedRef = useRef(false);
  // `onComplete` fires once per mounted session.
  const completedRef = useRef(false);

  /**
   * Rebuild the queue from the persisted attempt rows. When nothing is pending,
   * ask the cycle service to mark the cycle `completed` and surface `complete`.
   */
  const refresh = useCallback(async (generation: number): Promise<void> => {
    const { cycle: current, puzzles: rows } = optionsRef.current;
    const attempts = await optionsRef.current.attemptsRepository.listForCycle(current.id);
    if (generation !== generationRef.current) {
      return;
    }
    const missingPuzzleIds = new Set(current.puzzleIds.filter((id) => !rows.has(id)));
    const nextQueue = reconstructResume({
      puzzleIds: current.puzzleIds,
      attempts,
      retryFailed: current.config.retryFailed,
      missingPuzzleIds,
    });
    if (nextQueue.length > 0) {
      setQueue(nextQueue);
      setStatus('solving');
      setNotice(
        missingPuzzleIds.size > 0
          ? `${missingPuzzleIds.size} puzzle${missingPuzzleIds.size === 1 ? '' : 's'} are no longer available and were skipped.`
          : null,
      );
      return;
    }

    const resumed = await optionsRef.current.cycleService.resume(current.id);
    if (generation !== generationRef.current) {
      return;
    }
    setQueue([]);
    if (resumed.ok) {
      setCycle(resumed.cycle);
      setStatus('complete');
      setNotice(null);
      if (!completedRef.current) {
        completedRef.current = true;
        optionsRef.current.onComplete?.(resumed.cycle);
      }
      return;
    }
    if (resumed.reason === 'not-resumable' && resumed.status === 'completed') {
      setStatus('complete');
      setNotice(null);
      return;
    }
    setStatus('error');
    setNotice(
      resumed.reason === 'invalid-config'
        ? resumed.message
        : resumed.reason === 'not-resumable'
          ? 'This cycle is no longer resumable.'
          : 'The cycle could not be loaded.',
    );
  }, []);

  useEffect(() => {
    const generation = (generationRef.current += 1);
    exitedRef.current = false;
    completedRef.current = false;
    setCycle(optionsRef.current.cycle);
    setQueue([]);
    setStatus('loading');
    setNotice(null);
    refresh(generation).catch((error: unknown) => {
      if (generation !== generationRef.current) {
        return;
      }
      setQueue([]);
      setStatus('error');
      setNotice(messageOf(error));
    });
  }, [refresh, cycleId]);

  const handleOutcome = useCallback(
    async (outcome: PresentationOutcome | null): Promise<void> => {
      if (exitedRef.current) {
        return;
      }
      try {
        // `null` is a discard: no row was written, so the puzzle remains the
        // first pending entry and the rebuilt queue is unchanged.
        await refresh(generationRef.current);
        if (outcome === null && !exitedRef.current) {
          setNotice('Presentation discarded — this puzzle will be presented again.');
        }
      } catch (error) {
        setQueue([]);
        setStatus('error');
        setNotice(messageOf(error));
      }
    },
    [refresh],
  );

  const exit = useCallback((): void => {
    exitedRef.current = true;
  }, []);

  const entry = queue[0];
  const current = useMemo<CycleSessionPuzzle | null>(() => {
    if (entry === undefined) {
      return null;
    }
    const row = puzzles.get(entry.puzzleId);
    if (row === undefined) {
      return null;
    }
    return {
      row,
      context: {
        trainingSetId: set.id,
        cycleId: cycle.id,
        presentationIndex: entry.presentationIndex,
      },
      config: solveHintConfigOf(cycle.config),
    };
  }, [entry, puzzles, set.id, cycle]);

  const total = cycle.puzzleIds.length;
  const progress = useMemo<CycleSessionProgress>(() => {
    if (total === 0) {
      return { index: 0, total };
    }
    if (entry === undefined) {
      return { index: total, total };
    }
    const position = cycle.puzzleIds.indexOf(entry.puzzleId);
    return { index: position < 0 ? total : position + 1, total };
  }, [total, entry, cycle.puzzleIds]);

  return {
    current,
    progress,
    allowSkip: cycle.config.allowSkip,
    status,
    notice,
    recorder,
    now,
    handleOutcome,
    exit,
  };
}
