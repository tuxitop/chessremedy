import { describe, expect, it } from 'vitest';
import { pageWindow, showingLabel, totalPages } from './pagination';

describe('Game Library pagination math (Feature 017 §6)', () => {
  it('splits 77 rows at a page size of 50 into two pages', () => {
    expect(totalPages(77, 50)).toBe(2);
    expect(pageWindow(77, 1, 50)).toBe(50);
    expect(pageWindow(77, 2, 50)).toBe(27);
  });

  it('renders a single page when the matched set fits the page size', () => {
    expect(totalPages(1, 50)).toBe(1);
    expect(pageWindow(1, 1, 50)).toBe(1);
    expect(totalPages(50, 50)).toBe(1);
    expect(pageWindow(50, 1, 50)).toBe(50);
  });

  it('reports the remaining rows on the last page', () => {
    expect(pageWindow(100, 4, 25)).toBe(25);
    expect(pageWindow(101, 5, 25)).toBe(1);
    expect(pageWindow(99, 4, 25)).toBe(24);
  });

  it('never reports a negative or overflowing window', () => {
    expect(pageWindow(0, 1, 50)).toBe(0);
    // A page beyond the end (should have been clamped) never overflows.
    expect(pageWindow(77, 3, 50)).toBe(0);
    // Defensive: a non-positive page size still yields a valid page count.
    expect(totalPages(77, 0)).toBe(1);
  });

  it('labels the window with the matched total and singularises a total of one', () => {
    expect(showingLabel(50, 77)).toBe('Showing 50 of 77 games');
    expect(showingLabel(27, 77)).toBe('Showing 27 of 77 games');
    expect(showingLabel(1, 1)).toBe('Showing 1 of 1 game');
    expect(showingLabel(0, 0)).toBe('Showing 0 of 0 games');
  });
});
