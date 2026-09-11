import { describe, expect, it, vi } from 'vitest';
import { aggregateOf, emptyAggregate, notDetectedAggregate } from '@/domain/statistics';
import {
  EMPTY_STATE_LABEL,
  INSUFFICIENT_STATE_PREFIX,
  NOT_DETECTED_STATE_LABEL,
  aggregateDisplay,
  insufficientLabel,
} from './aggregateDisplay';

const format = (value: number): string => value.toFixed(1);

describe('aggregateDisplay', () => {
  it('shows the formatted value, the sample label and no state label for ok', () => {
    const display = aggregateDisplay(aggregateOf(88.25, 6, 'games'), format);
    expect(display.state).toBe('ok');
    expect(display.hidden).toBe(false);
    expect(display.text).toBe('88.3');
    expect(display.stateLabel).toBeNull();
    expect(display.n).toBe(6);
    expect(display.unit).toBe('games');
    expect(display.sampleLabel).toBe('n = 6 games');
  });

  it('hides the value and shows the insufficient placeholder below the minimum sample', () => {
    const display = aggregateDisplay(aggregateOf(1.5, 4, 'games'), format);
    expect(display.state).toBe('insufficient');
    expect(display.hidden).toBe(true);
    expect(display.text).toBeNull();
    expect(display.stateLabel).toBe('Insufficient data (n = 4)');
    expect(display.stateLabel).not.toBe('0');
    expect(display.n).toBe(4);
    expect(display.sampleLabel).toBe('n = 4 games');
  });

  it('hides the value and shows "No data" for empty, never a zero', () => {
    const display = aggregateDisplay(emptyAggregate('games'), format);
    expect(display.state).toBe('empty');
    expect(display.hidden).toBe(true);
    expect(display.text).toBeNull();
    expect(display.stateLabel).toBe(EMPTY_STATE_LABEL);
    expect(display.n).toBe(0);
  });

  it('hides the value and shows "Tactics not scanned" for notDetected', () => {
    const display = aggregateDisplay(notDetectedAggregate('games'), format);
    expect(display.state).toBe('notDetected');
    expect(display.hidden).toBe(true);
    expect(display.text).toBeNull();
    expect(display.stateLabel).toBe(NOT_DETECTED_STATE_LABEL);
  });

  it('passes the raw ok value to the formatter exactly once', () => {
    const spy = vi.fn((value: number) => `${value}`);
    aggregateDisplay(aggregateOf(12.5, 9, 'moves'), spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(12.5);
  });

  it('never calls the formatter for a hidden state', () => {
    const spy = vi.fn((value: number) => `${value}`);
    aggregateDisplay(aggregateOf(2, 4, 'games'), spy);
    aggregateDisplay(emptyAggregate('games'), spy);
    aggregateDisplay(notDetectedAggregate('games'), spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it('builds the insufficient label from the sample size', () => {
    expect(insufficientLabel(0)).toBe('Insufficient data (n = 0)');
    expect(insufficientLabel(4)).toBe(`${INSUFFICIENT_STATE_PREFIX} (n = 4)`);
  });
});
