import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { CycleConfigForm } from './CycleConfigForm';
import { DEFAULT_CYCLE_CONFIG, type CycleConfig } from '@/domain/training';
import { renderWithProviders } from '@/test/test-utils';

function Harness(): React.JSX.Element {
  const [config, setConfig] = useState<CycleConfig>(DEFAULT_CYCLE_CONFIG);
  return <CycleConfigForm config={config} onChange={setConfig} idPrefix="cfg" />;
}

describe('CycleConfigForm', () => {
  it('shows the effective config snapshot and updates it as controls change', () => {
    renderWithProviders(<Harness />);

    const snapshot = screen.getByTestId('cfg-config-snapshot');
    expect(snapshot).toHaveTextContent('Failed puzzles retried at the end of the cycle');
    expect(snapshot).toHaveTextContent('Allowed');

    fireEvent.change(screen.getByTestId('cfg-retry'), { target: { value: 'none' } });
    expect(snapshot).toHaveTextContent('No retries');

    fireEvent.click(screen.getByTestId('cfg-allow-skip'));
    expect(snapshot).toHaveTextContent('Not allowed');
  });

  it('reflects informational targets in the snapshot', () => {
    renderWithProviders(<Harness />);

    fireEvent.change(screen.getByTestId('cfg-target-accuracy'), { target: { value: '70' } });
    expect(screen.getByTestId('cfg-config-snapshot')).toHaveTextContent('70%');

    fireEvent.change(screen.getByTestId('cfg-planned-cycles'), { target: { value: '5' } });
    expect(screen.getByTestId('cfg-config-snapshot')).toHaveTextContent('5');
  });

  it('explains the hint levels and the informational (never a gate) targets', () => {
    renderWithProviders(<Harness />);

    const hintsHelp = screen.getByTestId('cycle-config-hints-help');
    expect(hintsHelp).toHaveTextContent('Level 1 — Relevant piece');
    expect(hintsHelp).toHaveTextContent('Level 4 — Full first move in SAN');
    expect(hintsHelp).toHaveTextContent('never count as a wrong move');

    const targetsHelp = screen.getByTestId('cycle-config-targets-help');
    expect(targetsHelp).toHaveTextContent('informational only');
    expect(targetsHelp).toHaveTextContent('never gates');
  });
});
