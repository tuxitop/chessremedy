import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChartTheme } from './useChartTheme';

describe('useChartTheme', () => {
  it('uses theme tokens (no fixed colour) for axis, grid, text and series', () => {
    const { result } = renderHook(() => useChartTheme());
    expect(result.current.axis).toMatch(/^var\(--/);
    expect(result.current.grid).toMatch(/^var\(--/);
    expect(result.current.text).toMatch(/^var\(--/);
    expect(result.current.tooltipBg).toMatch(/^var\(--/);
    expect(result.current.tooltipBorder).toMatch(/^var\(--/);
    expect(result.current.series.every((colour) => colour.startsWith('var('))).toBe(true);
  });

  it('keeps the canonical Feature-009 error-class colours', () => {
    const { result } = renderHook(() => useChartTheme());
    expect(result.current.error.inaccuracies).toBe('#d89000');
    expect(result.current.error.mistakes).toBe('#d94f00');
    expect(result.current.error.blunders).toBe('#c4261c');
    expect(result.current.error.missedTactics).toBe('#c2185b');
  });
});
