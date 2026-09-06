import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as React from 'react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import { AnalysisPanel, type StoredPanelData } from './AnalysisPanel';
import { useAnalysisController } from './useAnalysisController';
import { createFakeAnalysisService } from './test-support/fakeEngineService';

const CAPS: EngineCapabilities = {
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  hardwareConcurrency: 4,
  isMobile: false,
  build: 'lite-single',
  threads: 1,
  hashCapMb: 256,
};

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Flush the fake's microtask (`running` status) inside an act() boundary. */
async function flush(): Promise<void> {
  await act(async () => {});
}

function Harness({
  rig,
  autoStart,
  fen = START_FEN,
  stored = null,
}: {
  rig: ReturnType<typeof createFakeAnalysisService>;
  autoStart: boolean;
  fen?: string;
  stored?: StoredPanelData | null;
}): React.JSX.Element {
  const controller = useAnalysisController({
    service: rig.service,
    fen,
    capabilities: CAPS,
    autoStart,
  });
  return <AnalysisPanel controller={controller} capabilities={CAPS} fen={fen} stored={stored} />;
}

describe('AnalysisPanel', () => {
  it('starts with the engine off when autoStart is false', () => {
    const rig = createFakeAnalysisService();
    render(<Harness rig={rig} autoStart={false} />);
    expect(screen.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Off');
    expect(rig.jobs).toHaveLength(0);
  });

  it('auto-starts analysis and renders eval + engine version when autoStart is true', async () => {
    const rig = createFakeAnalysisService();
    render(<Harness rig={rig} autoStart={true} />);
    await flush();
    expect(rig.jobs).toHaveLength(1);
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Analyzing');
    act(() => rig.complete(0));
    expect(screen.getByTestId('position-eval')).toHaveTextContent('+0.21');
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Ready');
    expect(screen.getByTestId('engine-version')).toHaveTextContent('stockfish 18.0.8');
    expect(screen.getByTestId('engine-pv')).toHaveTextContent('1. e4 e5');
  });

  it('turning the engine off clears eval and shows Off', async () => {
    const rig = createFakeAnalysisService();
    render(<Harness rig={rig} autoStart={true} />);
    await flush();
    act(() => rig.complete(0));
    expect(screen.getByTestId('position-eval')).toHaveTextContent('+0.21');
    fireEvent.click(screen.getByTestId('engine-toggle'));
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Off');
    expect(screen.getByTestId('position-eval')).toHaveTextContent('\u2014');
  });

  it('shows a Cancel button while analyzing and cancels on click', async () => {
    const rig = createFakeAnalysisService();
    render(<Harness rig={rig} autoStart={true} />);
    await flush();
    expect(screen.getByTestId('engine-cancel')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId('engine-cancel'));
    });
    expect(rig.jobs[0]!.status).toBe('cancelled');
    // Cancel returns to the pre-analysis state: no eval, engine remains ready.
    expect(screen.getByTestId('position-eval')).toHaveTextContent('\u2014');
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Ready');
  });

  it('surfaces structured engine errors', async () => {
    const rig = createFakeAnalysisService();
    render(<Harness rig={rig} autoStart={true} />);
    await flush();
    const handle = rig.jobs[0]!;
    act(() => {
      handle.fail({ reason: 'worker-crashed', message: 'Engine worker failed: boom' });
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Engine worker failed: boom');
  });

  it('shows progress-driven lines before the final result (per reached depth)', async () => {
    const rig = createFakeAnalysisService();
    render(<Harness rig={rig} autoStart={true} />);
    await flush();
    // No final result yet — a progress event at depth 12 surfaces a live line.
    act(() => {
      rig.jobs[0]!.emitProgress({
        jobId: rig.jobs[0]!.id,
        depth: 12,
        multipv: 1,
        evaluation: { cp: 40 },
        principalVariation: [{ uci: 'e2e4' }, { uci: 'e7e5' }],
      });
    });
    expect(screen.getByTestId('engine-eval')).toHaveTextContent('+0.40');
    expect(screen.getByTestId('engine-pv')).toHaveTextContent('1. e4 e5');
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Analyzing');
    expect(screen.getByTestId('engine-depth-row')).toHaveTextContent('Depth: 12');
  });

  it('re-runs when a later move changes the FEN', async () => {
    const rig = createFakeAnalysisService();
    const { rerender } = render(<Harness rig={rig} autoStart={true} fen={START_FEN} />);
    await flush();
    expect(rig.jobs).toHaveLength(1);
    const nextFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    rerender(<Harness rig={rig} autoStart={true} fen={nextFen} />);
    await flush();
    expect(rig.jobs).toHaveLength(2);
    expect(rig.jobs[0]!.status).toBe('cancelled');
    expect(rig.jobs[1]!.fen).toBe(nextFen);
  });

  it('shows stored lines while the engine is off, without empty padding rows', () => {
    const rig = createFakeAnalysisService();
    const stored: StoredPanelData = {
      engineLabel: 'stockfish 18.0.8',
      evalText: '+0.20',
      depth: 21,
      lines: [{ evalText: '+0.20', pvText: '1. e4 e5' }],
    };
    render(<Harness rig={rig} autoStart={false} stored={stored} />);
    expect(screen.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('engine-result')).toBeInTheDocument();
    expect(screen.getByTestId('stored-line')).toBeInTheDocument();
    expect(screen.queryByTestId('engine-line-placeholder')).not.toBeInTheDocument();
  });

  it('never shows an empty engine-lines area when the engine is off', () => {
    const rig = createFakeAnalysisService();
    // A stored panel that has no lines (e.g. the final position of a review)
    // behaves like the plain "off" state: no region, no padding, a hint.
    const stored: StoredPanelData = {
      engineLabel: 'stockfish 18.0.8',
      evalText: null,
      depth: null,
      lines: [],
    };
    render(<Harness rig={rig} autoStart={false} stored={stored} />);
    expect(screen.queryByTestId('engine-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('engine-line-placeholder')).not.toBeInTheDocument();
    expect(screen.getByTestId('engine-idle')).toBeInTheDocument();
  });

  it('reserves the lines region while the engine is on, even before any line', () => {
    const rig = createFakeAnalysisService();
    render(<Harness rig={rig} autoStart={true} />);
    // autoStart is enabled synchronously; the engine has not produced a line.
    expect(screen.getByTestId('engine-toggle')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('engine-result')).toBeInTheDocument();
    expect(screen.getAllByTestId('engine-line-placeholder').length).toBeGreaterThan(0);
  });
});
