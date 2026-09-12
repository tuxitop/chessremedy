import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { FakeSyncService } from './test-support';

describe('SyncStatusIndicator', () => {
  it('renders nothing when no provider is configured', () => {
    const service = new FakeSyncService({
      configured: false,
      connected: false,
      status: 'disabled',
    });
    renderWithProviders(<SyncStatusIndicator service={service} />);
    expect(screen.queryByTestId('sync-status-indicator')).not.toBeInTheDocument();
  });

  it('renders nothing when configured but not connected', async () => {
    const service = new FakeSyncService({
      configured: true,
      connected: false,
      status: 'disconnected',
    });
    renderWithProviders(<SyncStatusIndicator service={service} />);
    await Promise.resolve();
    expect(screen.queryByTestId('sync-status-indicator')).not.toBeInTheDocument();
  });

  it('renders the live region text for a connected idle status', async () => {
    const service = new FakeSyncService({
      configured: true,
      connected: true,
      status: 'idle',
      lastSyncedAt: Date.now() - 5_000,
    });
    renderWithProviders(<SyncStatusIndicator service={service} />);

    const live = await screen.findByTestId('sync-status-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Synced');
    expect(screen.getByTestId('sync-status-indicator')).toHaveAttribute('data-status', 'idle');
    expect(screen.queryByTestId('sync-status-settings-link')).not.toBeInTheDocument();
  });

  it.each([
    ['syncing', /Syncing/],
    ['offline', /Offline/],
    ['error', /Sync error/],
    ['conflict', /Sync conflict/],
  ] as const)('renders the aria-live text for the %s status', async (status, pattern) => {
    const service = new FakeSyncService({ configured: true, connected: true, status });
    renderWithProviders(<SyncStatusIndicator service={service} />);

    const live = await screen.findByTestId('sync-status-live');
    expect(live).toHaveTextContent(pattern);
  });

  it('links to Settings for an actionable error status', async () => {
    const service = new FakeSyncService({
      configured: true,
      connected: true,
      status: 'error',
      lastError: 'Boom',
    });
    renderWithProviders(<SyncStatusIndicator service={service} />);

    const link = await screen.findByTestId('sync-status-settings-link');
    expect(link).toHaveAttribute('href', '/settings');
  });
});
