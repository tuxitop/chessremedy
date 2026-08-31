import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/test-utils';
import { Navigation } from './Navigation';

describe('Navigation', () => {
  it('renders one nav link per route', () => {
    renderWithProviders(<Navigation />);
    expect(document.querySelectorAll('nav a')).toHaveLength(6);
  });

  it('highlights the active route via aria-current or class', () => {
    renderWithProviders(<Navigation />, { initialEntries: ['/settings'] });
    const settings = document.querySelector('a[href="/settings"]');
    expect(settings).toBeInTheDocument();
    expect(settings?.className).toContain('active');
  });
});
