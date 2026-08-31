import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { PlaceholderPanel } from './PlaceholderPanel';

describe('PlaceholderPanel', () => {
  it('renders the badge, heading and description', () => {
    renderWithProviders(
      <PlaceholderPanel
        heading="Games"
        description="Import your games."
        badge="Coming in Feature 006"
      />,
    );
    expect(screen.getByTestId('placeholder-badge')).toHaveTextContent('Coming in Feature 006');
    expect(screen.getByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();
    expect(screen.getByText('Import your games.')).toBeInTheDocument();
  });
});
