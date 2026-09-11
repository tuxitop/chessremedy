import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import { TrainingSetSelector } from './TrainingSetSelector';
import { blockSetFixture, setFixture } from '@/domain/training/test-support';

const active = setFixture({ id: 'set-active', name: 'Active set', status: 'active' });
const archived = setFixture({ id: 'set-archived', name: 'Archived set', status: 'archived' });
const block = blockSetFixture({ id: 'set-block', name: 'Open block' });

describe('TrainingSetSelector', () => {
  it('lists the open block first, then active and archived sets grouped', () => {
    renderWithProviders(
      <TrainingSetSelector
        sets={[active]}
        archivedSets={[archived]}
        openBlock={block}
        value="set-block"
        onSelect={vi.fn()}
      />,
    );

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Open block (open block)');
    expect(screen.getByRole('group', { name: 'Active sets' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Archived sets' })).toBeInTheDocument();
  });

  it('emits the selected set id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <TrainingSetSelector
        sets={[active]}
        archivedSets={[archived]}
        openBlock={null}
        value="set-active"
        onSelect={onSelect}
      />,
    );

    await user.selectOptions(screen.getByTestId('training-set-selector'), 'set-archived');
    expect(onSelect).toHaveBeenCalledWith('set-archived');
  });

  it('does not duplicate the open block in the active list', () => {
    renderWithProviders(
      <TrainingSetSelector
        sets={[active, block]}
        archivedSets={[]}
        openBlock={block}
        value="set-block"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('option', { name: /Open block/ })).toHaveLength(1);
  });
});
