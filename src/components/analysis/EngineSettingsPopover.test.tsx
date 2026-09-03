import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EngineCapabilities } from '@/infrastructure/engine/capabilities';
import { defaultLiveSettings } from './engineSettings';
import { EngineSettingsPopover } from './EngineSettingsPopover';

const CAPS: EngineCapabilities = {
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  hardwareConcurrency: 4,
  isMobile: false,
  build: 'lite-single',
  threads: 1,
  hashCapMb: 256,
};

describe('EngineSettingsPopover', () => {
  it('shows the engine/profile/search/lines/threads/memory fields', () => {
    const settings = defaultLiveSettings(CAPS);
    render(
      <EngineSettingsPopover
        settings={settings}
        capabilities={CAPS}
        onChange={() => undefined}
        onApplyProfile={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('engine-settings-gear'));
    expect(screen.getByTestId('engine-settings-popover')).toBeInTheDocument();
    expect(screen.getByTestId('setting-engine')).toBeInTheDocument();
    expect(screen.getByTestId('setting-profile')).toBeInTheDocument();
    expect(screen.getByTestId('setting-search-seconds')).toBeInTheDocument();
    expect(screen.getByTestId('setting-lines')).toBeInTheDocument();
    expect(screen.getByTestId('setting-threads')).toBeInTheDocument();
    expect(screen.getByTestId('setting-memory')).toBeInTheDocument();
  });

  it('applies a profile preset through onApplyProfile', () => {
    const settings = defaultLiveSettings(CAPS);
    const onApplyProfile = vi.fn();
    render(
      <EngineSettingsPopover
        settings={settings}
        capabilities={CAPS}
        onChange={() => undefined}
        onApplyProfile={onApplyProfile}
      />,
    );
    fireEvent.click(screen.getByTestId('engine-settings-gear'));
    fireEvent.change(screen.getByTestId('setting-profile'), { target: { value: 'deep' } });
    expect(onApplyProfile).toHaveBeenCalledWith('deep');
  });
});
