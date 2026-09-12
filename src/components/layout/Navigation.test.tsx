import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/test-utils';
import { ANALYSIS_GLYPH } from '@/components/ui/icons';
import { Navigation } from './Navigation';

describe('Navigation', () => {
  it('renders one nav link per route', () => {
    renderWithProviders(<Navigation />);
    expect(document.querySelectorAll('nav a')).toHaveLength(6);
  });

  it('renders the canonical nav order and labels', () => {
    renderWithProviders(<Navigation />);
    const links = Array.from(document.querySelectorAll('nav a'));
    expect(links.map((link) => link.getAttribute('data-testid'))).toEqual([
      'nav-home',
      'nav-games',
      'nav-training',
      'nav-statistics',
      'nav-analysis',
      'nav-settings',
    ]);
    expect(links.map((link) => link.textContent?.replace(ANALYSIS_GLYPH, ''))).toEqual([
      'Home',
      'Games',
      'Training',
      'Statistics',
      'Analysis',
      'Settings',
    ]);
  });

  it('highlights the active route via aria-current or class', () => {
    renderWithProviders(<Navigation />, { initialEntries: ['/settings'] });
    const settings = document.querySelector('a[href="/settings"]');
    expect(settings).toBeInTheDocument();
    expect(settings?.className).toContain('active');
  });
});
