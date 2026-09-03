import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AnalysisJobHandle } from '@/infrastructure/engine/engineService';
import type {
  AnalysisJob,
  AnalysisOptions,
  EngineAnalysisResult,
  EngineJobError,
  EngineLine,
  EngineServiceStatus,
} from '@/infrastructure/engine/types';
import {
  EnginePanel,
  formatEvaluation,
  formatNodes,
  formatTime,
  formatPv,
  numberSans,
  type EnginePanelService,
} from './EnginePanel';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MATE_FEN = '6k1/5ppp/8/8/8/8/8/1R4K1 w - - 0 1';

afterEach(() => {
  vi.restoreAllMocks();
});

function line(
  evaluation: EngineLine['evaluation'],
  pv: readonly string[],
  extra?: Partial<EngineLine>,
): EngineLine {
  return {
    multipv: 1,
    evaluation,
    principalVariation: pv.map((uci) => ({ uci })),
    wdl: null,
    ...extra,
  };
}

function resultFor(
  handle: AnalysisJobHandle,
  fen: string,
  lines: readonly EngineLine[],
): EngineAnalysisResult {
  return {
    jobId: handle.id,
    position: fen,
    profile: handle.profile,
    lines,
    engine: {
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'stockfish-18-lite-single',
      profile: handle.profile,
    },
    timeMs: 100,
  };
}

function makeFakeService(): {
  service: EnginePanelService;
  jobs: AnalysisJobHandle[];
} {
  const jobs: AnalysisJobHandle[] = [];
  const status: EngineServiceStatus = {
    lifecycle: 'ready',
    engine: {
      engineName: 'stockfish',
      engineVersion: '18.0.8',
      engineBuild: 'stockfish-18-lite-single',
    },
    build: 'lite-single',
    activeJobId: null,
    queued: 0,
  };
  const service: EnginePanelService = {
    analyze(fen: string, options?: Partial<AnalysisOptions>): AnalysisJob {
      const handle = new AnalysisJobHandle(fen, { profile: options?.profile ?? 'fast' }, (job) =>
        service.cancel(job.id),
      );
      jobs.push(handle);
      return handle;
    },
    cancel(jobId: string) {
      const job = jobs.find((j) => j.id === jobId);
      job?.cancelFinish();
    },
    getStatus() {
      return status;
    },
    onStatusChange() {
      return () => undefined;
    },
  };
  return { service, jobs };
}

describe('EnginePanel', () => {
  it('offers the four profiles and a Start button', () => {
    const { service } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    const select = screen.getByTestId('engine-profile');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['fast', 'normal', 'tactical', 'deep']);
    expect(screen.getByTestId('engine-start')).toBeEnabled();
    expect(screen.queryByTestId('engine-stop')).toBeNull();
  });

  it('starts analysis with the current FEN and profile', () => {
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    fireEvent.change(screen.getByTestId('engine-profile'), { target: { value: 'tactical' } });
    fireEvent.click(screen.getByTestId('engine-start'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.fen).toBe(START_FEN);
    expect(jobs[0]!.profile).toBe('tactical');
    expect(screen.getByTestId('engine-stop')).toBeInTheDocument();
    expect(screen.queryByTestId('engine-start')).toBeNull();
  });

  it('renders progress fields and never a percentage', () => {
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    fireEvent.click(screen.getByTestId('engine-start'));
    const handle = jobs[0]!;
    act(() => {
      handle.emitProgress({ jobId: handle.id, depth: 12, nodes: 1_400_000, timeMs: 2100 });
    });
    expect(screen.getByTestId('engine-progress').textContent).toContain('Depth: 12');
    expect(screen.getByTestId('engine-progress').textContent).toContain('Nodes: 1.4M');
    expect(screen.getByTestId('engine-progress').textContent).toContain('Time: 2.1s');
    expect(screen.getByTestId('engine-panel').textContent).not.toContain('%');
    expect(screen.queryByText(/%\s*complete/i)).toBeNull();
  });

  it('renders a completed result with numbered SAN PV', () => {
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    fireEvent.click(screen.getByTestId('engine-start'));
    const handle = jobs[0]!;
    act(() => {
      handle.complete(resultFor(handle, START_FEN, [line({ cp: 21 }, ['e2e4', 'e7e5'])]));
    });
    expect(screen.getByTestId('engine-eval').textContent).toContain('+0.21');
    expect(screen.getByTestId('engine-pv').textContent).toBe('1. e4 e5');
  });

  it('renders mate evaluations distinctly and finds the mating move SAN', () => {
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={MATE_FEN} />);
    fireEvent.click(screen.getByTestId('engine-start'));
    const handle = jobs[0]!;
    act(() => {
      handle.complete(resultFor(handle, MATE_FEN, [line({ mate: 1 }, ['b1b8'], { depth: 12 })]));
    });
    expect(screen.getByTestId('engine-eval').textContent).toBe('M1');
    expect(screen.getByTestId('engine-pv').textContent).toBe('1. Rb8#');
  });

  it('does not render engine lines as a numbered list', () => {
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    fireEvent.click(screen.getByTestId('engine-start'));
    const handle = jobs[0]!;
    act(() => {
      handle.complete(
        resultFor(handle, START_FEN, [
          line({ cp: 30 }, ['e2e4', 'e7e5'], { multipv: 1 }),
          line({ cp: 10 }, ['d2d4', 'd7d5'], { multipv: 2 }),
        ]),
      );
    });
    const result = screen.getByTestId('engine-result');
    // No browser `<ol>` markers and no manual rank prefixes like `2. `.
    expect(result.textContent).not.toContain('2. ');
    const evals = screen.getAllByTestId('engine-eval').map((el) => el.textContent);
    expect(evals).toEqual(['+0.30', '+0.10']);
    const pvs = screen.getAllByTestId('engine-pv').map((el) => el.textContent);
    expect(pvs).toEqual(['1. e4 e5', '1. d4 d5']);
  });

  it('shows the full move list with a trailing control when the line overflows', () => {
    // Simulate a narrow line: the move list is longer than the container.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300);
    const longPv = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6'];
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    fireEvent.click(screen.getByTestId('engine-start'));
    const handle = jobs[0]!;
    act(() => {
      handle.complete(resultFor(handle, START_FEN, [line({ cp: 25 }, longPv)]));
    });
    // The full (non-truncated) move list is rendered…
    expect(screen.getByTestId('engine-pv').textContent).toBe(
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6',
    );
    // …and a trailing control sits at the end of the line.
    const toggle = screen.getByTestId('engine-line-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.textContent).toBe('\u25be');
    fireEvent.click(toggle);
    expect(screen.getByTestId('engine-line-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('engine-pv').textContent).toBe(
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6',
    );
    expect(screen.getByTestId('engine-line-toggle').textContent).toBe('\u25b4');
  });

  it('omits the control when the move list fits the line', () => {
    // No layout in happy-dom: widths are 0, so nothing overflows.
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    fireEvent.click(screen.getByTestId('engine-start'));
    const handle = jobs[0]!;
    act(() => {
      handle.complete(resultFor(handle, START_FEN, [line({ cp: 25 }, ['e2e4', 'e7e5'])]));
    });
    expect(screen.getByTestId('engine-pv').textContent).toBe('1. e4 e5');
    expect(screen.queryByTestId('engine-line-toggle')).toBeNull();
  });

  it('displays structured engine errors', () => {
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    fireEvent.click(screen.getByTestId('engine-start'));
    const handle = jobs[0]!;
    const error: EngineJobError = {
      reason: 'worker-crashed',
      message: 'Engine worker failed: boom',
    };
    act(() => {
      handle.fail(error);
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Engine worker failed: boom');
    expect(screen.getByTestId('engine-error')).toBeInTheDocument();
  });

  it('stops an active analysis via the Stop button', () => {
    const { service, jobs } = makeFakeService();
    render(<EnginePanel service={service} fen={START_FEN} />);
    fireEvent.click(screen.getByTestId('engine-start'));
    const handle = jobs[0]!;
    fireEvent.click(screen.getByTestId('engine-stop'));
    expect(handle.status).toBe('cancelled');
    expect(screen.getByTestId('engine-cancelled').textContent).toContain('Analysis stopped.');
    expect(screen.getByTestId('engine-start')).toBeInTheDocument();
  });

  it('disables Start without a FEN or service', () => {
    render(<EnginePanel service={null} fen={null} />);
    expect(screen.getByTestId('engine-start')).toBeDisabled();
  });
});

describe('EnginePanel formatting helpers', () => {
  it('formats evaluations without conflating mate and centipawns', () => {
    expect(formatEvaluation({ cp: 21 })).toBe('+0.21');
    expect(formatEvaluation({ cp: -134 })).toBe('-1.34');
    expect(formatEvaluation({ cp: 0 })).toBe('0.00');
    expect(formatEvaluation({ mate: 3 })).toBe('M3');
    expect(formatEvaluation({ mate: -5 })).toBe('-M5');
  });

  it('formats node counts and times', () => {
    expect(formatNodes(1234)).toBe('1.2k');
    expect(formatNodes(1_400_000)).toBe('1.4M');
    expect(formatNodes(321)).toBe('321');
    expect(formatTime(900)).toBe('900ms');
    expect(formatTime(2100)).toBe('2.1s');
  });

  it('numbers PVs with PGN move numbers derived from the FEN', () => {
    // White to move at move 1.
    expect(formatPv(START_FEN, [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }])).toBe(
      '1. e4 e5 2. Nf3',
    );
    // Black to move at move 1: `1... e5 2. Nf3`.
    const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(formatPv(blackToMove, [{ uci: 'e7e5' }, { uci: 'g1f3' }])).toBe('1... e5 2. Nf3');
    // Mid-game white-to-move at move 4 (castling-rights fixture; Nf3 already
    // developed, so White develops the queen's knight next).
    const castlingFen = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    expect(formatPv(castlingFen, [{ uci: 'd2d4' }, { uci: 'd7d5' }, { uci: 'b1c3' }])).toBe(
      '4. d4 d5 5. Nc3',
    );
  });

  it('numbers SAN lists directly and falls back to raw UCI', () => {
    expect(numberSans(START_FEN, ['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(formatPv(START_FEN, [{ uci: 'zzz' }])).toBe('zzz');
  });
});
