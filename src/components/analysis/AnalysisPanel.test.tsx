import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as React from 'react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import { AnalysisPanel } from './AnalysisPanel';
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
}: {
  rig: ReturnType<typeof createFakeAnalysisService>;
  autoStart: boolean;
  fen?: string;
}): React.JSX.Element {
  const controller = useAnalysisController({
    service: rig.service,
    fen,
    capabilities: CAPS,
    autoStart,
  });
  return (
    <AnalysisPanel
      controller={controller}
      capabilities={CAPS}
      bottomColor="white"
      sideToMove="white"
    />
  );
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
});
