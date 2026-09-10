import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { puzzleRowFixture, blunderRowFixture } from '@/domain/puzzle/test-support';
import { buildAttemptRow } from '@/domain/training';
import { makeMove } from '@/domain/analysis/test-support';
import { fenOf } from '@/domain/chess';
import type { AnalysisProfile, EngineMetadata, MoveAnalysis } from '@/domain/chess';
import type { PuzzleRow } from '@/domain/puzzle';
import type { PresentationOutcome } from '@/domain/training';
import type { PuzzleAttemptRecorderLike, RecordAttemptInput } from '@/infrastructure/training';
import { PuzzleAttemptWriteError } from '@/infrastructure/training';
import { solveConfigFixture, cycleContextFixture } from '@/domain/training/test-support';
import { buildSolveLine, mainlinePathOf } from '@/components/chessboard/puzzleMoveLine';
import { positionAtPath } from '@/components/chessboard/positionTree';
import { assembleBlunderPuzzle } from '@/domain/puzzle';
import { DETECTION_VERSION } from '@/domain/tactics';
import type { LiveEngineService } from '@/components/analysis/useLiveAnalysis';
import type {
  AnalysisJob,
  AnalysisJobEvent,
  EngineLine,
  EngineServiceStatus,
} from '@/infrastructure/engine/types';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import { SolveScreen, type StoredAnalysisLookup } from './SolveScreen';

type FakeResultLine = EngineLine;

interface FakeJob extends AnalysisJob {
  listeners: Set<(event: AnalysisJobEvent) => void>;
  finish(result: {
    jobId: string;
    position: string;
    profile: AnalysisProfile;
    timeMs: number;
    lines: readonly FakeResultLine[];
    engine: EngineMetadata;
  }): void;
}

const { chessboardProps, engineFake } = vi.hoisted(() => {
  const caps: EngineCapabilities = {
    sharedArrayBuffer: false,
    crossOriginIsolated: false,
    hardwareConcurrency: 4,
    isMobile: false,
    build: 'lite-single',
    threads: 1,
    hashCapMb: 256,
  };
  const engineMeta: EngineMetadata = {
    engineName: 'stockfish',
    engineVersion: '18.0.8',
    engineBuild: 'stockfish-18-lite-single',
    profile: 'normal',
  };
  const status: EngineServiceStatus = {
    lifecycle: 'ready',
    engine: engineMeta,
    build: 'lite-single',
    activeJobId: null,
    queued: 0,
  };
  const jobs: FakeJob[] = [];
  let nextId = 1;
  const service: LiveEngineService = {
    analyze(fen: string, options?: { profile?: AnalysisProfile }) {
      const listeners = new Set<(event: AnalysisJobEvent) => void>();
      let jobStatus: AnalysisJob['status'] = 'queued';
      const job: FakeJob = {
        id: `job-${nextId++}`,
        fen,
        profile: options?.profile ?? 'normal',
        status: jobStatus,
        outcome: new Promise(() => undefined),
        listeners,
        cancel() {
          jobStatus = 'cancelled';
          for (const listener of listeners) {
            listener({ type: 'status', status: 'cancelled' });
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        finish(result) {
          jobStatus = 'completed';
          for (const listener of listeners) {
            listener({ type: 'result', result });
          }
        },
      };
      jobs.push(job);
      queueMicrotask(() => {
        if (jobStatus === 'queued') {
          jobStatus = 'running';
          for (const listener of listeners) {
            listener({ type: 'status', status: 'running' });
          }
        }
      });
      return job;
    },
    cancel() {},
    getStatus() {
      return status;
    },
    onStatusChange() {
      return () => undefined;
    },
  };
  const complete = (index: number, options?: { lines?: readonly FakeResultLine[] }) => {
    const job = jobs[index];
    if (!job) {
      return;
    }
    job.finish({
      jobId: job.id,
      position: job.fen,
      profile: job.profile,
      timeMs: 5,
      lines: options?.lines ?? [
        {
          multipv: 1,
          evaluation: { cp: 120 },
          principalVariation: [{ uci: 'h5f7' }, { uci: 'e8d8' }],
          wdl: null,
        },
      ],
      engine: engineMeta,
    });
  };
  return {
    chessboardProps: [] as Array<Record<string, unknown>>,
    engineFake: { service, jobs, caps, complete },
  };
});

const engine = engineFake;

vi.mock('@/components/analysis/useBrowserAnalysisEngine', () => ({
  useBrowserAnalysisEngine: () => ({
    service: engineFake.service,
    capabilities: engineFake.caps,
    error: null,
  }),
}));

vi.mock('@/components/chessboard/Chessboard', () => ({
  Chessboard: (props: Record<string, unknown>) => {
    chessboardProps.push(props);
    return null;
  },
}));

const NO_RECORDS: StoredAnalysisLookup = {
  listForGameAndAnalysis: async () => [],
};

interface Rig {
  readonly recorder: PuzzleAttemptRecorderLike;
  readonly calls: RecordAttemptInput[];
  setFailing(value: boolean): void;
}

function createRig(): Rig {
  const calls: RecordAttemptInput[] = [];
  let failing = false;
  const recorder: PuzzleAttemptRecorderLike = {
    async record(input) {
      calls.push(input);
      if (failing) {
        throw new PuzzleAttemptWriteError(
          buildAttemptRow({ ...input, endedAt: input.endedAt ?? 1_700_000_000_000 }),
          new Error('simulated disk error'),
        );
      }
      return {
        status: 'written',
        attemptRow: buildAttemptRow({ ...input, endedAt: input.endedAt ?? 1_700_000_000_000 }),
      };
    },
  };
  return {
    recorder,
    calls,
    setFailing(value) {
      failing = value;
    },
  };
}

function renderSolve(
  row: PuzzleRow,
  rig: Rig,
  onExit: (outcome: PresentationOutcome | null) => void,
  options: {
    readonly storedAnalysis?: StoredAnalysisLookup;
    readonly showTimer?: boolean;
    readonly onRestart?: () => void;
  } = {},
): void {
  render(
    <SolveScreen
      row={row}
      context={cycleContextFixture('fixture:cycle', `${row.sourceGameId}:${row.sourcePly}`, 1)}
      config={solveConfigFixture()}
      recorder={rig.recorder}
      onExit={onExit}
      storedAnalysis={options.storedAnalysis ?? NO_RECORDS}
      {...(options.showTimer !== undefined ? { showTimer: options.showTimer } : {})}
      {...(options.onRestart !== undefined ? { onRestart: options.onRestart } : {})}
    />,
  );
}

function lastBoard(): Record<string, unknown> {
  const last = chessboardProps[chessboardProps.length - 1];
  if (!last) {
    throw new Error('No Chessboard has rendered.');
  }
  return last;
}

async function waitForInteractive(): Promise<void> {
  await waitFor(() => {
    expect(lastBoard().interactive).toBe(true);
  });
}

function boardMove(from: string, to: string): void {
  const props = lastBoard();
  const onMove = props.onMove as ((f: string, t: string) => void) | undefined;
  if (!onMove) {
    throw new Error('Board is not interactive.');
  }
  act(() => onMove(from, to));
}

/** A purpose-built blunder row whose start position ends an authored prefix. */
function rowWithPrefix(): { row: PuzzleRow; records: readonly MoveAnalysis[] } {
  const STANDARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const prefix = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];
  const built = buildSolveLine({ startFen: STANDARD, mainline: prefix });
  const records = prefix.map((uci, ply) =>
    makeMove(ply, {
      gameId: 'fixture:prefix-game',
      analysisId: 'analysis:prefix-game',
      playedMove: { san: '', uci },
      positionFen: fenOf(positionAtPath(built.tree, mainlinePathOf(built.tree, ply))),
    }),
  );
  const fen = fenOf(positionAtPath(built.tree, mainlinePathOf(built.tree, prefix.length)));
  const row = assembleBlunderPuzzle(
    {
      sourceGameId: 'fixture:prefix-game',
      sourcePly: prefix.length,
      analysisId: 'analysis:prefix-game',
      startingFen: fen,
      userMovePlayed: 'd2d4',
      bestMove: 'f1c4',
      evalBefore: { cp: 30, mate: null },
      evalAfter: { cp: -240, mate: null },
      detectionVersion: DETECTION_VERSION,
    },
    1_700_000_000_000,
  );
  return { row, records };
}

/** The deterministic missed-mate (mate-one) prefix through sourcePly 6. */
const MATE_ONE_PREFIX = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6'];

/** True prefix records ending exactly at `puzzleRowFixture('mate-one')`. */
function matePrefixRecordsFor(row: PuzzleRow): readonly MoveAnalysis[] {
  const STANDARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const built = buildSolveLine({ startFen: STANDARD, mainline: MATE_ONE_PREFIX });
  return MATE_ONE_PREFIX.map((uci, ply) =>
    makeMove(ply, {
      gameId: row.sourceGameId,
      analysisId: row.analysisId,
      playedMove: { san: '', uci },
      positionFen: fenOf(positionAtPath(built.tree, mainlinePathOf(built.tree, ply))),
    }),
  );
}

/** Fabricated prefix chain ending at the given row's startingFen (scholar). */
function scholarRecordsFor(gameId: string, analysisId: string): readonly MoveAnalysis[] {
  const STANDARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd1h5'];
  const built = buildSolveLine({ startFen: STANDARD, mainline: moves });
  return moves.map((uci, ply) =>
    makeMove(ply, {
      gameId,
      analysisId,
      playedMove: { san: '', uci },
      positionFen: fenOf(positionAtPath(built.tree, mainlinePathOf(built.tree, ply))),
    }),
  );
}

describe('SolveScreen (Feature 012, plan 012b single-view redesign)', () => {
  beforeEach(() => {
    chessboardProps.length = 0;
    engine.jobs.splice(0);
  });

  it('presents a fresh puzzle: drawable interactive board, objective, game context text, "{color} to move…", no clock, no result, locked engine, no counters or text entry', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    expect(screen.getByTestId('solve-objective')).toHaveTextContent('Forced mate');
    await waitFor(() =>
      expect(screen.getByTestId('solve-movelist-status')).toHaveTextContent('White to move…'),
    );
    // The historical game move is written out as SAN in the info area.
    expect(screen.getByTestId('solve-game-move-note')).toHaveTextContent(
      'd3 was played in the game — find a better move.',
    );
    expect(screen.queryByTestId('solve-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('solve-clock')).not.toBeInTheDocument();
    // The engine top panel is always present; only its toggle is locked until
    // the puzzle finishes (owner UX ruling) — with a clear locked state.
    expect(screen.getByTestId('solve-engine-toggle')).toBeDisabled();
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Locked until the puzzle ends');
    expect(screen.queryByTestId('engine-idle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('solve-wrong-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('solve-hint-count')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Enter a move')).not.toBeInTheDocument();
    expect(screen.getByTestId('solve-movelist')).toBeInTheDocument();

    await waitForInteractive();
    const board = lastBoard();
    expect(board.orientation).toBe('white');
    expect(board.drawable).toBe(true);
    expect(rig.calls).toEqual([]);
  });

  it('shows the solve clock only when the timer setting is on', async () => {
    const rig = createRig();
    renderSolve(blunderRowFixture(), rig, () => undefined, { showTimer: true });
    expect(await screen.findByTestId('solve-clock')).toHaveTextContent('0:00');
    await waitFor(() =>
      expect(screen.getByTestId('solve-movelist-status')).toHaveTextContent('White to move…'),
    );
  });

  it('solves via the board, writes one row, shows Success inside the move list, then Next advances the host', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(blunderRowFixture(), rig, onExit);

    await waitForInteractive();
    boardMove('h5', 'f7');

    await waitFor(() => expect(screen.getByTestId('solve-result')).toHaveTextContent('Success'));
    expect(screen.getByTestId('solve-result').className).toContain('resultSuccess');
    expect(rig.calls).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('solve-next')).toBeEnabled());

    fireEvent.click(screen.getByTestId('solve-next'));
    expect(onExit).toHaveBeenCalledTimes(1);
    const outcome = onExit.mock.calls[0]![0] as PresentationOutcome | null;
    expect(outcome?.result).toBe('solvedFirstTry');
    expect(outcome?.attemptRow).toBeDefined();
  });

  it('hint presses never fail the puzzle; a hint-then-solve stays solvedWithHelp', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    await waitForInteractive();
    fireEvent.click(screen.getByTestId('solve-hint'));
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent('The piece is on h5');
    // Still solving at the decision point after a hint.
    expect(lastBoard().interactive).toBe(true);
    expect(screen.queryByTestId('solve-result')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('solve-hint'));
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent('Move it to f7');

    boardMove('h5', 'f7');
    await waitFor(() =>
      expect(screen.getByTestId('solve-result')).toHaveTextContent('Solved with hints'),
    );
    expect(screen.getByTestId('solve-result').className).toContain('resultHelp');
    expect(rig.calls).toHaveLength(1);
    const written = rig.calls[0];
    expect(written?.counters.hintCount).toBeGreaterThan(0);
  });

  it('the FIRST hint press highlights the source square violet through the square-class map (no circle)', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    await waitForInteractive();
    // One single press now highlights a square (level 2 = the source square).
    fireEvent.click(screen.getByTestId('solve-hint'));
    const classes = lastBoard().customSquareClasses as ReadonlyMap<string, string> | undefined;
    expect(classes?.get('h5')).toBe('solve-cls-hint');
    // Hint squares are CSS highlights, never Chessground circles.
    const shapes = lastBoard().autoShapes as Array<{ orig: string; dest?: string }>;
    expect(shapes.some((s) => s.dest === undefined)).toBe(false);
  });

  it('hint presses highlight the hint squares violet and draw only the violet best-move arrow', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    await waitForInteractive();
    fireEvent.click(screen.getByTestId('solve-hint'));
    fireEvent.click(screen.getByTestId('solve-hint'));
    // Level 2 highlights h5; level 3 adds f7 and the violet arrow h5→f7.
    const classes = lastBoard().customSquareClasses as ReadonlyMap<string, string> | undefined;
    expect(classes?.get('h5')).toBe('solve-cls-hint');
    expect(classes?.get('f7')).toBe('solve-cls-hint');
    const shapes = lastBoard().autoShapes as Array<{ orig: string; dest: string; brush: string }>;
    expect(shapes.some((s) => s.brush === 'violet' && s.orig === 'h5' && s.dest === 'f7')).toBe(
      true,
    );
    // No hint square is drawn as a circle (every auto shape is an arrow).
    expect(shapes.every((s) => s.dest !== undefined)).toBe(true);
  });

  it('one wrong move fails the puzzle immediately, but the board returns to the decision point and a later correct solve keeps the recorded Failed outcome', async () => {
    const rig = createRig();
    const { row, records } = rowWithPrefix();
    renderSolve(row, rig, () => undefined, {
      storedAnalysis: { listForGameAndAnalysis: async () => records },
    });

    await waitForInteractive();
    boardMove('d2', 'd4');
    expect(screen.getByTestId('solve-announcement')).toHaveTextContent(
      'not the move that achieves',
    );
    // The attempt is recorded failed immediately (fail-once) while the user
    // keeps solving.
    await waitFor(() => expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed'));
    expect(screen.getByTestId('solve-result').className).toContain('resultFailed');
    expect(rig.calls).toHaveLength(1);
    expect(rig.calls[0]?.trigger).toBe('wrongMove');

    // DEFECT 1: the wrong move never hijacks the mainline. The board stays at
    // the decision node (the solver's side to move), the ply counter does not
    // advance past the decision, and the wrong SAN shows as a parenthesized
    // variation — never as the active mainline ply.
    expect((lastBoard().position as { turn: 'white' | 'black' }).turn).toBe('white');
    expect(lastBoard().interactive).toBe(true);
    expect(screen.getByTestId('solve-ply')).toHaveTextContent('4/4');

    const list = screen.getByTestId('solve-movelist');
    await waitFor(() => {
      expect(list).toHaveTextContent('e4');
      expect(list).toHaveTextContent('e5');
      expect(list).toHaveTextContent('Nf3');
      expect(list).toHaveTextContent('Nc6');
      expect(list.textContent).toContain('(3. d4)');
    });
    const d4 = screen
      .getAllByTestId('move-list-move')
      .find((m) => m.getAttribute('data-san') === 'd4');
    expect(d4).toBeTruthy();
    expect(d4?.getAttribute('aria-current')).toBeNull();

    // The correct move is still playable from the decision node.
    boardMove('f1', 'c4');
    await waitFor(() => {
      expect(list).toHaveTextContent('Bc4');
    });
    // A later correct solve is confirmed green, but the outcome stays Failed
    // and only the one wrong-move row was ever written.
    await waitFor(() =>
      expect(screen.getByTestId('solve-confirm')).toHaveTextContent(
        'Correct! This was recorded as a failed attempt.',
      ),
    );
    expect(screen.getByTestId('solve-confirm').className).toContain('confirm');
    expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed');
    expect(rig.calls).toHaveLength(1);
    expect(rig.calls[0]?.counters.wrongMoveCount).toBe(1);
    await waitFor(() => expect(screen.getByTestId('solve-next')).toBeEnabled());
  });

  it('flashes the wrong move’s from/to squares red via square classes, then clears the flash after ~900ms', async () => {
    const rig = createRig();
    const { row, records } = rowWithPrefix();
    renderSolve(row, rig, () => undefined, {
      storedAnalysis: { listForGameAndAnalysis: async () => records },
    });

    await waitForInteractive();
    boardMove('d2', 'd4');

    await waitFor(() => {
      const classes = lastBoard().customSquareClasses as ReadonlyMap<string, string> | undefined;
      expect(classes?.get('d2')).toBe('solve-cls-wrong');
      expect(classes?.get('d4')).toBe('solve-cls-wrong');
    });
    // Wrong squares are CSS highlights, never red Chessground circles.
    const shapes = lastBoard().autoShapes as Array<{ brush: string }>;
    expect(shapes.some((s) => s.brush === 'red')).toBe(false);

    await waitFor(
      () => {
        const classes = lastBoard().customSquareClasses as ReadonlyMap<string, string> | undefined;
        expect(classes?.get('d2')).toBeUndefined();
        expect(classes?.get('d4')).toBeUndefined();
      },
      { timeout: 2500 },
    );
  });

  it('nests the puzzle-info card inside the move-list pane', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    await waitForInteractive();
    expect(
      within(screen.getByTestId('solve-movelist')).getByTestId('solve-puzzle-info'),
    ).toBeInTheDocument();
  });

  it('unlocks the engine toggle as soon as a wrong move records a fail, while the presentation stays open', async () => {
    const rig = createRig();
    const { row, records } = rowWithPrefix();
    renderSolve(row, rig, () => undefined, {
      storedAnalysis: { listForGameAndAnalysis: async () => records },
    });

    await waitForInteractive();
    expect(screen.getByTestId('solve-engine-toggle')).toBeDisabled();

    boardMove('d2', 'd4');
    await waitFor(() => expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed'));
    // The presentation is still open (the user may keep trying)…
    expect(lastBoard().interactive).toBe(true);
    // …but the recorded fail already makes the engine available.
    await waitFor(() => expect(screen.getByTestId('solve-engine-toggle')).toBeEnabled());
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Off');
  });

  it('keeps the board playable after the puzzle finishes and analyses the position moved to, without writing another attempt', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('exchange-win'), rig, () => undefined);

    await waitForInteractive();
    boardMove('a3', 'd3');
    await waitFor(() => expect(screen.getByTestId('solve-result')).toHaveTextContent('Success'));
    expect(rig.calls).toHaveLength(1);

    // The finished board is interactive like the analysis page (Black to move).
    await waitFor(() => expect(lastBoard().interactive).toBe(true));
    expect((lastBoard().position as { turn: 'white' | 'black' }).turn).toBe('black');

    // Turn the engine on: it analyses the finished position.
    fireEvent.click(screen.getByTestId('solve-engine-toggle'));
    await act(async () => {});
    const jobsAfterToggle = engine.jobs.length;
    expect(jobsAfterToggle).toBeGreaterThan(0);

    // A free exploration move updates the displayed position, the move list and
    // the analysed FEN — and never writes a second attempt row.
    boardMove('e8', 'f8');
    await waitFor(() =>
      expect((lastBoard().position as { turn: 'white' | 'black' }).turn).toBe('white'),
    );
    await waitFor(() => expect(engine.jobs.length).toBeGreaterThan(jobsAfterToggle));
    expect(engine.jobs[engine.jobs.length - 1]!.fen).toContain(' w ');
    expect(screen.getByTestId('solve-movelist')).toHaveTextContent('Kf8');
    expect(rig.calls).toHaveLength(1);
  });

  it('a wrong move on the deterministic missed-mate never advances past the decision node, shows as a variation, and a later Qxf7# confirms the failed result', async () => {
    const rig = createRig();
    const row = puzzleRowFixture('mate-one');
    renderSolve(row, rig, () => undefined, {
      storedAnalysis: {
        listForGameAndAnalysis: async () => matePrefixRecordsFor(row),
      },
    });

    await waitForInteractive();
    // The game prefix (… Nf6) renders before any puzzle move.
    const list = screen.getByTestId('solve-movelist');
    await waitFor(() => expect(list).toHaveTextContent('Qh5'));

    // Wrong 4.d4 at the sourcePly-6 decision (White to move).
    boardMove('d2', 'd4');
    await waitFor(() => expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed'));

    // The board is still at the decision node: White to move, interactive, and
    // the ply counter stays 6/6 (it never jumps to 7/7 as the wrong mainline).
    expect((lastBoard().position as { turn: 'white' | 'black' }).turn).toBe('white');
    expect(lastBoard().interactive).toBe(true);
    expect(screen.getByTestId('solve-ply')).toHaveTextContent('6/6');

    // The wrong attempt renders parenthesized under the decision move's row,
    // not as the active mainline ply.
    await waitFor(() => expect(list.textContent).toContain('(4. d4)'));
    const d4 = screen
      .getAllByTestId('move-list-move')
      .find((m) => m.getAttribute('data-san') === 'd4');
    expect(d4).toBeTruthy();
    expect(d4?.getAttribute('aria-current')).toBeNull();
    const active = screen
      .getAllByTestId('move-list-move')
      .find((m) => m.getAttribute('aria-current') === 'step');
    expect(active?.getAttribute('data-san')).toBe('Nf6');

    // The solution is not spoiled: its SAN appears nowhere in the move list
    // before it is played.
    expect(list.textContent).not.toContain('Qxf7');

    // The correct Qxf7# is still playable from the decision node and the
    // recorded Failed outcome stays with a green confirmation.
    boardMove('h5', 'f7');
    await waitFor(() =>
      expect(screen.getByTestId('solve-confirm')).toHaveTextContent(
        'Correct! This was recorded as a failed attempt.',
      ),
    );
    expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed');
    expect(rig.calls).toHaveLength(1);
    expect(rig.calls[0]?.trigger).toBe('wrongMove');
    await waitFor(() => expect(screen.getByTestId('solve-next')).toBeEnabled());
  });

  it('renders the game prefix as a mainline when prefix records are supplied', async () => {
    const rig = createRig();
    const row = puzzleRowFixture('mate-one');
    const records = scholarRecordsFor(row.sourceGameId, row.analysisId);
    renderSolve(row, rig, () => undefined, {
      storedAnalysis: { listForGameAndAnalysis: async () => records },
    });

    await waitForInteractive();
    const list = screen.getByTestId('solve-movelist');
    await waitFor(() => {
      expect(list).toHaveTextContent('e4');
      expect(list).toHaveTextContent('e5');
      expect(list).toHaveTextContent('Nf3');
      expect(list).toHaveTextContent('Bc4');
    });
  });

  it('View solution gives up: the stored solution plays out on the mainline with Failed, engine toggle unlocks only after finish', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    await waitForInteractive();
    expect(screen.getByTestId('solve-engine-toggle')).toBeDisabled();

    fireEvent.click(screen.getByTestId('solve-solution'));
    await waitFor(() => expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed'));
    expect(screen.getByTestId('solve-result').className).toContain('resultFailed');
    expect(rig.calls).toHaveLength(1);
    expect(rig.calls[0]?.trigger).toBe('gaveUp');
    expect(screen.getByTestId('solve-movelist')).toHaveTextContent('Qxf7');
    // View solution writes the whole solution out as SAN in the info area.
    expect(screen.getByTestId('solve-solution-line')).toHaveTextContent('Solution: Qxf7#');
    // The engine toggle unlocks (with normal styling) only after the finish.
    await waitFor(() => expect(screen.getByTestId('solve-engine-toggle')).toBeEnabled());
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Off');
    await waitFor(() => expect(screen.getByTestId('solve-next')).toBeEnabled());
  });

  it('post-finish engine toggle analyzes the end position with a stubbed engine and fills the reserved eval bar', async () => {
    const rig = createRig();
    renderSolve(blunderRowFixture(), rig, () => undefined);

    await waitForInteractive();
    boardMove('h5', 'f7');
    await waitFor(() => expect(screen.getByTestId('solve-engine-toggle')).toBeInTheDocument());
    // Engine off: reserved empty column.
    expect(screen.getByTestId('solve-eval-reserved')).toBeInTheDocument();

    const jobsBefore = engine.jobs.length;
    fireEvent.click(screen.getByTestId('solve-engine-toggle'));
    expect(engine.jobs.length).toBeGreaterThan(jobsBefore);
    expect(screen.queryByTestId('solve-eval-reserved')).not.toBeInTheDocument();
    await act(async () => {});
    act(() => engine.complete(engine.jobs.length - 1));
    await waitFor(() => expect(screen.getByTestId('engine-result')).toBeInTheDocument());
    expect(screen.getByTestId('evaluation-bar')).toBeInTheDocument();
  });

  it('keeps a failed write retryable with an inline error and never enables Next on an unwritten row', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    renderSolve(puzzleRowFixture('mate-one'), rig, onExit);
    rig.setFailing(true);

    await waitForInteractive();
    fireEvent.click(screen.getByTestId('solve-solution'));

    await waitFor(() => expect(screen.getByTestId('solve-write-error')).toBeInTheDocument());
    expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed');
    expect(screen.getByTestId('solve-next')).toBeDisabled();

    rig.setFailing(false);
    fireEvent.click(screen.getByTestId('solve-retry-write'));
    await waitFor(() => expect(screen.getByTestId('solve-next')).toBeEnabled());
    expect(rig.calls).toHaveLength(2);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Restart appears once the user has used a hint (no outcome yet) and resets the line to the decision point', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    await waitForInteractive();
    expect(screen.queryByTestId('solve-restart')).not.toBeInTheDocument();

    // A hint counts as "started" but never records an outcome.
    fireEvent.click(screen.getByTestId('solve-hint'));
    const restart = await screen.findByTestId('solve-restart');
    fireEvent.click(restart);

    expect(lastBoard().interactive).toBe(true);
    expect(screen.queryByTestId('solve-result')).not.toBeInTheDocument();
    expect(rig.calls).toEqual([]);
  });

  it('Restart is offered after finish only when the host supplies a restart seam, and fires it', async () => {
    const rig = createRig();
    const onExit = vi.fn();
    const onRestart = vi.fn();
    renderSolve(puzzleRowFixture('mate-one'), rig, onExit, { onRestart });

    await waitForInteractive();
    fireEvent.click(screen.getByTestId('solve-solution'));
    await waitFor(() => expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed'));

    const restart = await screen.findByTestId('solve-restart');
    fireEvent.click(restart);
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('does not offer a post-finish Restart when the host supplies no restart seam', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('mate-one'), rig, () => undefined);

    await waitForInteractive();
    fireEvent.click(screen.getByTestId('solve-solution'));
    await waitFor(() => expect(screen.getByTestId('solve-result')).toHaveTextContent('Failed'));
    expect(screen.queryByTestId('solve-restart')).not.toBeInTheDocument();
  });

  it('transport moves across the line and, while still solving, the board is not interactive away from the decision point', async () => {
    const rig = createRig();
    renderSolve(puzzleRowFixture('material-combination'), rig, () => undefined);

    await waitForInteractive();
    // First accepted move (Nxf7) auto-plays the opponent reply (…Qe7), leaving
    // the puzzle still solving at the next decision point.
    boardMove('g5', 'f7');
    await waitFor(() => expect(screen.getByTestId('solve-ply')).toHaveTextContent('2/2'));
    expect(lastBoard().interactive).toBe(true);

    fireEvent.click(screen.getByTestId('nav-first'));
    expect(lastBoard().interactive).toBe(false);
    fireEvent.click(screen.getByTestId('nav-last'));
    expect(screen.getByTestId('solve-ply')).toHaveTextContent('2/2');
  });
});
