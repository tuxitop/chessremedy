import { describe, expect, it } from 'vitest';
import { chartStateFromPoints, chartStateLabel } from './chartState';

describe('chartStateFromPoints', () => {
  it('is ok when at least one point is plottable', () => {
    expect(chartStateFromPoints(['insufficient', 'ok', 'empty'])).toBe('ok');
  });

  it('prefers notDetected, then insufficient, then empty', () => {
    expect(chartStateFromPoints(['empty', 'insufficient'])).toBe('insufficient');
    expect(chartStateFromPoints(['empty', 'notDetected'])).toBe('notDetected');
    expect(chartStateFromPoints(['empty'])).toBe('empty');
    expect(chartStateFromPoints([])).toBe('empty');
  });
});

describe('chartStateLabel', () => {
  it('returns an explicit text placeholder for every non-ok state', () => {
    expect(chartStateLabel('ok')).toBeNull();
    expect(chartStateLabel('insufficient', 4)).toBe('Insufficient data (n = 4)');
    expect(chartStateLabel('empty')).toBe('No data');
    expect(chartStateLabel('notDetected')).toBe('Tactics not scanned');
  });
});
