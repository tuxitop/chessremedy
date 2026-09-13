import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/infrastructure/db/database';
import { createFakeImportService } from './test-support/fakeImportService';
import { ImportDialog } from './ImportDialog';

describe('ImportDialog', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('hosts a single form and switches platform without a second component', async () => {
    const rig = createFakeImportService();
    render(
      <ImportDialog service={rig.service} onClose={() => undefined} onImported={() => undefined} />,
    );

    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    // Defaults to Chess.com; the shared form is rendered once.
    expect(screen.getByTestId('import-username-chesscom')).toBeInTheDocument();
    expect(screen.queryByTestId('import-username-lichess')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId('import-provider'), 'lichess');

    expect(screen.getByTestId('import-username-lichess')).toBeInTheDocument();
    expect(screen.queryByTestId('import-username-chesscom')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^import-run-/)).toHaveLength(1);
  });

  it('closes via the Close control and via Escape', async () => {
    const rig = createFakeImportService();
    const onClose = vi.fn();
    render(<ImportDialog service={rig.service} onClose={onClose} onImported={() => undefined} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('import-dialog-close'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
