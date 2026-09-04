import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import type { GameListFilters } from './gameListFilters';
import { DEFAULT_GAME_LIST_FILTERS } from './gameListFilters';
import { GameListFiltersBar } from './GameListFiltersBar';

function Harness(): React.JSX.Element {
  const [filters, setFilters] = useState<GameListFilters>(DEFAULT_GAME_LIST_FILTERS);
  return <GameListFiltersBar filters={filters} onChange={setFilters} matched={2} total={5} />;
}

describe('GameListFiltersBar', () => {
  it('renders controls and reports the matched count', () => {
    render(<Harness />);
    expect(screen.getByTestId('gfilter-count')).toHaveTextContent('2 of 5 games');
    expect(screen.getByTestId('gfilter-opponent')).toBeInTheDocument();
    expect(screen.getByTestId('gfilter-reset')).toBeDisabled();
  });

  it('narrows a category chip and enables Reset', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const blitz = screen.getByTestId('gfilter-timecontrol-blitz');
    expect(blitz).toHaveAttribute('aria-pressed', 'false');
    await user.click(blitz);
    expect(blitz).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('gfilter-reset')).toBeEnabled();
  });

  it('filters by opponent and resets', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId('gfilter-opponent'), 'bob');
    await user.click(screen.getByTestId('gfilter-reset'));
    expect(screen.getByTestId('gfilter-opponent')).toHaveValue('');
    expect(screen.getByTestId('gfilter-reset')).toBeDisabled();
  });
});
