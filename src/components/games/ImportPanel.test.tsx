import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/infrastructure/db/database';
import { settingsRepository } from '@/infrastructure/db/settings-repository';
import { createFakeImportService } from './test-support/fakeImportService';
import { ImportPanel } from './ImportPanel';
import { DEFAULT_IMPORT_FILTERS, markPaused, patchJob, type ImportJob } from '@/domain/import';
import { createImportJob } from '@/domain/import';

function pausedJob(): ImportJob {
  return markPaused(
    patchJob(
      createImportJob('chesscom', 'remy', DEFAULT_IMPORT_FILTERS, Date.now()),
      { addCounters: { seen: 10, inserted: 5 } },
      Date.now(),
    ),
    Date.now(),
  );
}

describe('ImportPanel (chess.com)', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('disables run until a username is typed, then starts an import', async () => {
    const rig = createFakeImportService();
    const onImported = vi.fn();
    render(<ImportPanel provider="chesscom" service={rig.service} onImported={onImported} />);
    const user = userEvent.setup();

    const runButton = screen.getByTestId('import-run-chesscom');
    expect(runButton).toBeDisabled();

    await user.type(screen.getByTestId('import-username-chesscom'), 'remy');
    expect(runButton).toBeEnabled();

    await user.click(runButton);
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));

    expect(rig.starts).toHaveLength(1);
    expect(rig.starts[0]).toMatchObject({ provider: 'chesscom', username: 'remy' });
    expect(rig.starts[0]!.filters).toEqual(DEFAULT_IMPORT_FILTERS);
    expect(await screen.findByTestId('import-counter-inserted-chesscom')).toHaveTextContent(
      'new 1',
    );
    expect(screen.getByTestId('import-status-chesscom')).toHaveTextContent(/Done/);
  });

  it('sends the narrowed time-control and custom time-frame selection', async () => {
    const rig = createFakeImportService();
    render(<ImportPanel provider="lichess" service={rig.service} onImported={() => undefined} />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId('import-username-lichess'), 'carlsen');

    // Unchecking "All time controls" pre-selects blitz; add rapid.
    await user.click(screen.getByTestId('import-tc-all-lichess'));
    await user.click(screen.getByTestId('import-tc-rapid-lichess'));

    await user.selectOptions(screen.getByTestId('import-time-frame-lichess'), 'custom');
    fireEvent.change(screen.getByTestId('import-date-from-lichess'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByTestId('import-date-to-lichess'), {
      target: { value: '2026-02-01' },
    });

    await user.click(screen.getByTestId('import-run-lichess'));
    await waitFor(() => expect(rig.starts).toHaveLength(1));
    expect(rig.starts[0]!.filters).toEqual({
      timeFrame: { preset: 'custom', from: '2026-01-01', to: '2026-02-01' },
      timeControls: { kind: 'categories', categories: ['blitz', 'rapid'] },
    });
  });

  it('surfaces a failed run as an alert', async () => {
    const rig = createFakeImportService();
    rig.nextError = 'Player not found. Check the username and try again.';
    render(<ImportPanel provider="chesscom" service={rig.service} onImported={() => undefined} />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId('import-username-chesscom'), 'ghost');
    await user.click(screen.getByTestId('import-run-chesscom'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Player not found');
    expect(await screen.findByTestId('import-run-chesscom')).toBeEnabled();
  });

  it('shows a Resume action for a paused stored job', async () => {
    const rig = createFakeImportService();
    rig.jobs.set('chesscom:remy', pausedJob());
    await settingsRepository.set('import.chesscom.username', 'remy');

    render(<ImportPanel provider="chesscom" service={rig.service} onImported={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByTestId('import-run-chesscom')).toHaveTextContent('Resume'),
    );
    expect(screen.getByTestId('import-status-chesscom')).toHaveTextContent(/Paused/);
  });
});
