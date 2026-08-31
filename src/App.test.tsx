import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/test-utils';
import { App } from '@/App';

describe('App', () => {
  it('renders without crashing', () => {
    const { container } = renderWithProviders(<App />, { withRouter: false });
    expect(container).toBeInTheDocument();
  });
});
