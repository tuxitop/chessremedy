import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import { ALL_PARTITIONS_LABEL, partitionOptions } from '@/presentation/dashboard';
import { PartitionSelector } from './PartitionSelector';

const options = partitionOptions([
  { platform: 'lichess', timeControl: 'rapid', combined: false },
  { platform: 'chesscom', timeControl: 'blitz', combined: false },
]);

describe('PartitionSelector', () => {
  it('lists All partitions first plus each concrete partition and emits the key', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<PartitionSelector options={options} value="all" onChange={onChange} />);

    expect(screen.getByRole('option', { name: ALL_PARTITIONS_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Lichess · Rapid' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chess.com · Blitz' })).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('partition-selector'), 'lichess:rapid');
    expect(onChange).toHaveBeenCalledWith('lichess:rapid');
  });
});
