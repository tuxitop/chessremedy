import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { usePuzzleTimerSetting } from '@/hooks/usePuzzleTimerSetting';
import { SolveScreen } from '@/components/puzzles/solve';
import { GAME_SOURCE_LABELS } from '@/domain/chess/gameSource';
import { dateIsoOf } from '@/domain/gameLibrary/timeframe';
import type { PuzzleRow } from '@/domain/puzzle';
import { buildAttemptRow, DEFAULT_SOLVE_HINT_CONFIG } from '@/domain/training';
import type { PresentationOutcome, SessionPuzzleContext } from '@/domain/training';
import type { GameSummary } from '@/infrastructure/db/games-repository';
import { gamesRepository } from '@/infrastructure/db/games-repository';
import { puzzlesRepository } from '@/infrastructure/db/puzzles-repository';
import type { PuzzleAttemptRecorderLike } from '@/infrastructure/training';
import styles from './PuzzlesPage.module.css';

/**
 * A game that owns at least one generated puzzle row (the practice queue is
 * built from the `puzzles` table directly — no analysis state is required).
 */
interface CandidateGame {
  readonly summary: GameSummary;
  readonly count: number;
}

/**
 * One practice session over a chosen game's puzzle rows (in `sourcePly`
 * order). `rows` is `null` only while the rows are being read. `cursor` is the
 * index of the puzzle currently presented; when it reaches `rows.length` the
 * session shows its completion state. `presentation` remounts the solving
 * screen so each outcome/discard starts a fresh presentation.
 */
interface PracticeSession {
  readonly gameId: string;
  readonly label: string;
  readonly rows: readonly PuzzleRow[] | null;
  readonly cursor: number;
  readonly presentation: number;
}

/**
 * Practice sessions are ephemeral: a stable pseudo cycle id scopes the rows
 * that `usePuzzleSolve` builds, and nothing is ever persisted under it (real
 * cycle ids and persisted attempts belong to Feature 013). `presentationIndex`
 * simply counts the presented row's place in the queue.
 */
function practiceContext(gameId: string, presentationIndex: number): SessionPuzzleContext {
  return {
    trainingSetId: `practice:set:${gameId}`,
    cycleId: `practice:cycle:${gameId}`,
    presentationIndex,
  };
}

/**
 * The Feature-012 recorder contract implemented as an in-memory stub: every
 * presentation outcome is acknowledged as `'written'` with the attempt row the
 * domain builds, but nothing touches the `puzzleAttempts` table. Practice must
 * never persist attempt rows — Feature 013 owns persisted attempts under real
 * cycle ids.
 */
function createPracticeRecorder(): PuzzleAttemptRecorderLike {
  return {
    async record(input) {
      return {
        status: 'written',
        attemptRow: buildAttemptRow({ ...input, endedAt: input.endedAt ?? Date.now() }),
      };
    },
  };
}

/** Every stored game that has at least one puzzle row, newest first (D6). */
async function loadGamesWithPuzzles(): Promise<readonly CandidateGame[]> {
  const summaries = await gamesRepository.listGameSummaries();
  const ids = summaries.map((summary) => summary.id);
  const counts = await puzzlesRepository.countForGames(ids);
  const games: CandidateGame[] = [];
  for (const summary of summaries) {
    const count = counts[summary.id] ?? 0;
    if (count > 0) {
      games.push({ summary, count });
    }
  }
  return games;
}

function playersLabel(summary: GameSummary): string {
  return `${summary.whitePlayer.name} vs ${summary.blackPlayer.name} · ${summary.result}`;
}

function metaLabel(summary: GameSummary, count: number): string {
  const parts: string[] = [];
  const date = dateIsoOf(summary.playedAt);
  if (date !== null) {
    parts.push(date);
  }
  parts.push(GAME_SOURCE_LABELS[summary.source]);
  parts.push(`${count} ${count === 1 ? 'puzzle' : 'puzzles'}`);
  return parts.join(' · ');
}

export function PuzzlesPage(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [games, setGames] = useState<readonly CandidateGame[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const recorder = useMemo<PuzzleAttemptRecorderLike>(() => createPracticeRecorder(), []);
  const { showPuzzleTimer } = usePuzzleTimerSetting();
  const pickerHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const wasInSession = useRef(false);

  const reload = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    setReloadTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const candidates = await loadGamesWithPuzzles();
        if (!cancelled) {
          setGames(candidates);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setGames([]);
          setLoadError('Could not load your games from local storage.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const beginSession = useCallback((candidate: CandidateGame): void => {
    setNotice(null);
    setSession({
      gameId: candidate.summary.id,
      label: playersLabel(candidate.summary),
      rows: null,
      cursor: 0,
      presentation: 1,
    });
  }, []);

  const endSession = useCallback((): void => {
    setSession(null);
    reload();
  }, [reload]);

  const practiseAgain = useCallback((): void => {
    setSession((current) =>
      current === null
        ? current
        : { ...current, cursor: 0, presentation: current.presentation + 1 },
    );
  }, []);

  useEffect(() => {
    if (session === null || session.rows !== null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await puzzlesRepository.listForGame(session.gameId);
        if (cancelled) {
          return;
        }
        if (rows.length === 0) {
          setNotice('That game no longer has any puzzles — pick another game to practise.');
          setSession(null);
          reload();
          return;
        }
        setSession((current) =>
          current === null || current.gameId !== session.gameId ? current : { ...current, rows },
        );
      } catch {
        if (!cancelled) {
          setNotice('Could not load that game’s puzzles from local storage.');
          setSession(null);
          reload();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, reload]);

  const handlePresentationExit = useCallback((outcome: PresentationOutcome | null): void => {
    setSession((current) => {
      if (current === null || current.rows === null) {
        return current;
      }
      const rows = current.rows;
      if (outcome === null) {
        return { ...current, presentation: current.presentation + 1 };
      }
      const next = current.cursor + 1;
      return next >= rows.length
        ? { ...current, cursor: rows.length, presentation: current.presentation + 1 }
        : { ...current, cursor: next, presentation: current.presentation + 1 };
    });
  }, []);

  const handleRestartSession = useCallback((): void => {
    setSession((current) =>
      current === null ? current : { ...current, presentation: current.presentation + 1 },
    );
  }, []);

  // Keep focus inside the page: the solving screen focuses its own objective
  // on entry; ending a session moves focus back to the picker heading.
  useEffect(() => {
    const inSession = session !== null;
    if (!inSession && wasInSession.current) {
      wasInSession.current = false;
      pickerHeadingRef.current?.focus();
    } else if (inSession) {
      wasInSession.current = true;
    }
  }, [session]);

  if (session !== null) {
    if (session.rows === null) {
      return (
        <div className={styles.page} data-testid="puzzles-page">
          <SessionHeader label={session.label} onExit={endSession} />
          <section className={styles.statePanel} data-testid="puzzles-practice-loading">
            <h2 className={styles.stateTitle}>Loading practice puzzles…</h2>
            <p className={styles.stateDescription}>Reading the stored puzzles of this game.</p>
          </section>
        </div>
      );
    }
    if (session.cursor >= session.rows.length) {
      return (
        <div className={styles.page} data-testid="puzzles-page">
          <SessionHeader label={session.label} />
          <section
            className={styles.statePanel}
            data-testid="puzzles-practice-complete"
            aria-labelledby="puzzles-practice-complete-title"
          >
            <h2 className={styles.stateTitle} id="puzzles-practice-complete-title">
              Practice complete
            </h2>
            <p className={styles.stateDescription}>
              You went through all {session.rows.length}{' '}
              {session.rows.length === 1 ? 'puzzle' : 'puzzles'} of this game. These were practice
              attempts only — nothing was recorded as training history. Real cycle training with
              persisted attempts arrives with Feature 013.
            </p>
            <div className={styles.panelActions}>
              <Button
                variant="primary"
                data-testid="puzzles-practice-again"
                onClick={practiseAgain}
              >
                Practice this game again
              </Button>
              <Button variant="secondary" data-testid="puzzles-practice-exit" onClick={endSession}>
                Choose another game
              </Button>
            </div>
          </section>
        </div>
      );
    }
    const total = session.rows.length;
    return (
      <div className={styles.page} data-testid="puzzles-page">
        <SessionHeader label={session.label} onExit={endSession} />
        <div className={styles.sessionBar}>
          <p className={styles.progress} role="status" data-testid="puzzles-practice-progress">
            Puzzle {session.cursor + 1} of {total}
          </p>
        </div>
        <SolveScreen
          key={session.presentation}
          row={session.rows[session.cursor]!}
          context={practiceContext(session.gameId, session.cursor + 1)}
          config={DEFAULT_SOLVE_HINT_CONFIG}
          recorder={recorder}
          onExit={handlePresentationExit}
          onRestart={handleRestartSession}
          showTimer={showPuzzleTimer}
        />
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="puzzles-page">
      <header className={styles.header}>
        <h1 className={styles.heading} tabIndex={-1} ref={pickerHeadingRef}>
          Puzzles
        </h1>
        <p className={styles.subtitle} data-testid="puzzles-practice-note">
          Practise solving the puzzles generated from your own games. This is an interim practice
          surface — attempts are practice only and are never saved as training history.
        </p>
      </header>

      {loadError !== null ? (
        <section className={styles.statePanel} role="alert">
          <p className={styles.stateDescription}>{loadError}</p>
          <Button variant="secondary" data-testid="puzzles-practice-retry" onClick={reload}>
            Try again
          </Button>
        </section>
      ) : null}

      {notice !== null ? (
        <p className={styles.notice} role="status" data-testid="puzzles-practice-notice">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <section className={styles.statePanel} data-testid="puzzles-practice-loading">
          <p className={styles.stateDescription}>Loading games with puzzles…</p>
        </section>
      ) : games.length === 0 ? (
        <section
          className={styles.statePanel}
          data-testid="puzzles-practice-empty"
          aria-labelledby="puzzles-practice-empty-title"
        >
          <h2 className={styles.stateTitle} id="puzzles-practice-empty-title">
            No practice puzzles yet
          </h2>
          <p className={styles.stateDescription}>
            Puzzles must first be generated from your games before you can practise them. Open the
            Game Library, pick an analysed game and choose “Generate puzzles”.
          </p>
          <Link className={styles.libraryLink} data-testid="puzzles-practice-to-games" to="/games">
            Go to the Game Library
          </Link>
        </section>
      ) : (
        <section className={styles.picker} aria-labelledby="puzzles-practice-heading">
          <h2 className={styles.panelHeading} id="puzzles-practice-heading">
            Choose a game to practise
          </h2>
          <ul className={styles.gameList} data-testid="puzzles-practice-list">
            {games.map((candidate) => {
              const { summary, count } = candidate;
              return (
                <li
                  key={summary.id}
                  className={styles.gameRow}
                  data-testid={`puzzles-practice-game-${summary.id}`}
                >
                  <div className={styles.gameText}>
                    <span className={styles.players}>{playersLabel(summary)}</span>
                    <span className={styles.meta}>{metaLabel(summary, count)}</span>
                  </div>
                  <Button
                    variant="primary"
                    data-testid={`puzzles-practice-choose-${summary.id}`}
                    onClick={() => beginSession(candidate)}
                  >
                    Practise
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Shared session header: which game is being practised, with an optional exit control. */
function SessionHeader({
  label,
  onExit,
}: {
  label: string;
  onExit?: () => void;
}): React.JSX.Element {
  return (
    <header className={styles.sessionHeader}>
      <div>
        <p className={styles.sessionLabel} data-testid="puzzles-practice-game-label">
          {label}
        </p>
        <h1 className={styles.heading}>Puzzles practice</h1>
        <p className={styles.subtitle}>
          Interim practice — attempts are never recorded as training history.
        </p>
      </div>
      {onExit !== undefined ? (
        <Button variant="secondary" data-testid="puzzles-practice-exit" onClick={onExit}>
          End practice
        </Button>
      ) : null}
    </header>
  );
}
